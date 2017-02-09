'use strict';

const _ = require('lodash');
const pgp = require('pg-promise');
const log = require('../util/log');
const baseSql = require('../util/base-sql');
const serverErrors = require('../util/server-errors');
const mapPgError = require('../util/map-pg-error');
const sendJson = require('../util/send-json');
const adjustResourceQuantity = require('../util/adjust-resource-quantity');

// This is the function called when a query fails.
function handleQueryError({err, req, res, resource, crudAction, query}) {
  var serverError;

  // First, check to see if it's a pgp QueryResultError. If it
  // is, we generate the appropriate server error.
  if (err instanceof pgp.errors.QueryResultError) {
    serverError = mapPgError(err.code);
  }

  // If it's not a pgp QueryResultError, we send over tbe generic server error.
  else {
    serverError = serverErrors.generic;
  }

  log.warn({
    resourceName: resource.name,
    reqId: req.id,
    err, crudAction, query
  }, 'There was a query error with a CRUD request.');
  res.status(serverError.code);
  sendJson(res, {
    errors: [serverError.body()]
  });
}

// The Controller interfaces with the database. It performs our CRUD operations.
// Access to the controller occurs through the routes.
function Controller(resource, db) {
  this.resource = resource;
  this.tableName = resource.name;
  this.db = db;

  _.bindAll(this, ['create', 'read', 'update', 'delete', 'formatTransaction']);
}

function buildResponseRelationships(result, resource) {
  const response = {};
  _.forEach(resource.relations, (relation, columnBase) => {
    const columnName = `${columnBase}_id`;
    const id = result[columnName];

    if (id) {
      response[columnBase] = {
        type: adjustResourceQuantity.getPluralName(relation.resource),
        id
      };
    }
  });

  return response;
}

Object.assign(Controller.prototype, {
  // This transforms the data from the format that it is in the
  // database to the one we need for our endpoint.
  // This would one day have things like supporting more types from the ORM
  // layer. For now it's pretty basic.
  formatTransaction(t) {
    const attrs = ([]).concat(Object.keys(this.resource.attributes));
    const meta = ([]).concat(Object.keys(this.resource.meta));
    const relationships = buildResponseRelationships(t, this.resource);

    const pickedAttrs = _.pick(t, attrs);
    const pickedMeta = _.pick(t, meta);

    const response = {
      id: String(t.id),
      type: this.resource.plural_form,
    };

    if (_.size(pickedAttrs)) {
      response.attributes = pickedAttrs;
    }
    if (_.size(pickedMeta)) {
      response.meta = pickedMeta;
    }
    if (_.size(relationships)) {
      response.relationships = relationships;
    }

    return response;
  },

  create(req, res) {
    const data = _.get(req, 'body.data', {});
    const rawAttrs = data.attributes;
    const rawMeta = data.meta;
    const rawRelations = data.relationships;

    const attrs = _.pick(rawAttrs, Object.keys(this.resource.attributes));
    // At the moment, this allows users to modify the built-in-meta, which is
    // no good.
    const meta = _.pick(rawMeta, Object.keys(this.resource.meta));
    const relations = _.pick(rawRelations, Object.keys(this.resource.relations));

    // This maps the name that the user passes in to the ID that they pass in.
    // A chain().mapValue().mapKeys() could probably do this in a cleaner
    // manner.
    const relData = _.reduce(Object.keys(relations), (result, field) => {
      result[`${field}_id`] = _.get(relations[field], 'data.id');
      return result;
    }, {});

    const columns = Object.assign(attrs, meta, relData);

    if (!_.size(columns)) {
      res.status(serverErrors.noValidFields.code);
      sendJson(res, {
        errors: [serverErrors.noValidFields.body(this.resource.plural_form)]
      });
      return;
    }

    const query = baseSql.create({
      tableName: this.tableName,
      db: this.db,
      attrs: columns
    });

    log.info({query, resource: this.resource, reqId: req.id}, 'Creating a resource');

    this.db.one(query)
      .then(result => {
        log.info({query, resource: this.resource, reqId: req.id}, 'Resource created.');
        res.status(201);
        sendJson(res, {
          data: this.formatTransaction(result)
        });
      })
      .catch(err => handleQueryError({err, req, res, resource: this.resource, crudAction: 'create', query}));
  },

  read(req, res) {
    const id = req.params.id;
    const isSingular = Boolean(id);

    const pagination = this.resource.pagination;
    const pageNumber = Number(_.get(req.query, 'page.number', pagination.defaultPageNumber));
    const pageSize = Number(_.get(req.query, 'page.size', pagination.defaultPageSize));

    // Find the fields to return
    let fieldsToReturn = _.get(req.query, `fields.${this.resource.plural_form}`, '*');

    // This captures if the user specifies the parameter, but doesn't actually
    // enter a value.
    if (!fieldsToReturn) {
      fieldsToReturn = '*';
    }

    // The user can pass in comma-separated fields. i.e.
    // ?fields[people]=first_name,last_name,address
    // to just get those fields.
    if (fieldsToReturn !== '*') {
      fieldsToReturn = fieldsToReturn
        .split(',')
        // Ensure only valid fields are specified
        .filter(field => _.includes(Object.keys(this.resource.attributes), field));
    }

    let fieldsIsArray = Array.isArray(fieldsToReturn);

    // If they tried to specify fields, but none of them exist on this resource,
    // then we return an error response.
    if (fieldsIsArray && fieldsToReturn.length === 0) {
      res.status(serverErrors.noValidFields.code);
      sendJson(res, {
        errors: [serverErrors.noValidFields.body(this.resource.plural_form)]
      });
      res.end();
      return;
    }

    if (fieldsIsArray) {
      // We always need the ID, as well as the meta attributes. `fields`
      // only refers to relationships and attributes.
      fieldsToReturn = fieldsToReturn.concat('id', Object.keys(this.resource.meta));
    }

    // Only paginate if this is a readMany, and if the resource has specified
    // pagination.
    const enablePagination = !isSingular && pagination.enabled;

    // `isSingular` is whether or not we're looking for 1
    // or all. This coercion is fine because SERIALs start at 1
    const query = baseSql.read({
      tableName: this.tableName,
      db: this.db,
      fields: fieldsToReturn,
      pageSize,
      pageNumber,
      enablePagination,
      id
    });
    const method = isSingular ? 'one' : 'any';

    log.info({query, resourceName: this.resource.name, reqId: req.id}, 'Reading a resource');

    this.db[method](query)
      .then(result => {
        let formattedResult;
        let totalCount;
        if (!Array.isArray(result)) {
          formattedResult = this.formatTransaction(result);
        } else {
          totalCount = result.length ? result[0].total_count : 0;
          formattedResult = _.map(result, this.formatTransaction);
        }
        log.info({query, resourceName: this.resource.name, reqId: req.id}, 'Read a resource');

        const dataToSend = {
          data: formattedResult,
        };

        if (enablePagination) {
          dataToSend.meta = {
            page_number: pageNumber,
            page_size: pageSize,
            total_count: Number(totalCount)
          };
        }

        sendJson(res, dataToSend);
      })
      .catch(err => {
        const crudAction = isSingular ? 'readOne' : 'readMany';
        handleQueryError({err, req, res, resource: this.resource, crudAction, query});
      });
  },

  update(req, res) {
    const id = req.params.id;
    const rawAttrs = _.get(req, 'body.data.attributes', {});
    const rawMeta = _.get(req, 'body.data.meta', {});
    const rawRelations = _.get(req, 'body.data.relationships', {});

    const attrs = _.pick(rawAttrs, Object.keys(this.resource.attributes));
    // At the moment, this allows users to modify the built-in-meta, which is
    // no good.
    const meta = _.pick(rawMeta, Object.keys(this.resource.meta));
    const relations = _.pick(rawRelations, Object.keys(this.resource.relations));

    // This maps the name that the user passes in to the ID that they pass in.
    // A chain().mapValue().mapKeys() could probably do this in a cleaner
    // manner.
    const relData = _.reduce(Object.keys(relations), (result, field) => {
      result[`${field}_id`] = _.get(relations[field], 'data.id');
      return result;
    }, {});

    const columns = Object.assign(attrs, meta, relData);

    let query;

    // If there's nothing to update, we can use a read query.
    if (!_.size(columns)) {
      query = baseSql.read({
        tableName: this.tableName,
        db: this.db,
        fields: '*',
        id
      });
    }

    // Otherwise, we get the update query.
    else {
      query = baseSql.update({
        tableName: this.tableName,
        db: this.db,
        attrs: columns,
        id
      });
    }

    log.info({query, resource: this.resource, reqId: req.id}, 'Updating a resource');

    this.db.one(query)
      .then(result => {
        log.info({query, resource: this.resource, reqId: req.id}, 'Updated a resource');
        sendJson(res, {
          data: this.formatTransaction(result)
        });
      })
      .catch(err => handleQueryError({err, req, res, resource: this.resource, crudAction: 'update', query}));
  },

  delete(req, res) {
    const query = baseSql.delete({
      tableName: this.tableName,
      db: this.db,
      id: req.params.id
    });

    log.info({query, resourceName: this.resource.name, reqId: req.id}, 'Deleting a resource');

    this.db.one(query)
      .then(() => {
        log.info({query, resourceName: this.resource.name, reqId: req.id}, 'Deleted a resource');
        res.status(204).end();
      })
      .catch(err => handleQueryError({err, req, res, resource: this.resource, crudAction: 'delete', query}));
  }
});

module.exports = Controller;
