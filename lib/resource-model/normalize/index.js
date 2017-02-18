'use strict';

const _ = require('lodash');
const normalizeFields = require('./util/normalize-fields');
const normalizePagination = require('./util/normalize-pagination');
const normalizeRelationships = require('./util/normalize-relationships');
const normalizeBuiltInMeta = require('./util/normalize-built-in-meta');

const resourceProps = [
  'name', 'plural_form', 'attributes', 'meta', 'relationships', 'actions', 'pagination'
];

// Resource Models written by hand are allowed to be incomplete; for instance,
// if you're OK with accepting a default value.
// This takes an incomplete resource model, and outputs a complete version of
// it.
module.exports = function(resourceModel) {
  const resource = _.merge(
    {
      // "book" => "books"
      plural_form: `${resourceModel.name}s`,
      attributes: {},
      meta: {},
      relationships: {},
      actions: {
        create: true,
        read_one: true,
        read_many: true,
        update: true,
        delete: true
      },
      pagination: {},
      // Set the default built-in-meta
      built_in_meta: {
        created_at: true,
        updated_at: true
      }
    },
    resourceModel
  );

  resource.pagination = normalizePagination(resource.pagination);
  resource.attributes = normalizeFields(resource.attributes);
  resource.relationships = normalizeRelationships(resource.relationships);

  // Combine the built in meta with any user-defined meta
  const builtInMeta = normalizeBuiltInMeta(resource.built_in_meta);
  const userDefinedMeta = normalizeFields(resource.meta);
  resource.meta = Object.assign(builtInMeta, userDefinedMeta);

  return _.pick(resource, resourceProps);
};