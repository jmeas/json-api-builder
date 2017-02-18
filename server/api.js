'use strict';

const _ = require('lodash');
const express = require('express');
const routeBuilder = require('express-routebuilder');
const Resource = require('./resource');
const serverErrors = require('./util/server-errors');
const loadResourceModels = require('../lib/resource-model/load-from-disk');
const sendJson = require('./util/send-json');
const jsonApiHeaders = require('./util/json-api-headers');
const generateDefinitions = require('../lib/resource-definition/generate-from-raw');
const createDb = require('../lib/database');
const adjustResourceQuantity = require('./util/adjust-resource-quantity');
const log = require('./util/log');

module.exports = function(options) {
  const router = express.Router();
  router.use(jsonApiHeaders);

  const db = createDb(options);
  const apiVersion = options.apiVersion;

  log.info({
    resourcesDirectory: options.resourcesDirectory
  }, 'Loading resources from the resources directory.');
  var resourceModels = loadResourceModels(options.resourcesDirectory);
  const definitions = generateDefinitions(resourceModels);

  log.info({
    resourcesDirectory: options.resourcesDirectory
  }, 'Successfully loaded resources from the resources directory.');

  adjustResourceQuantity.setResources(definitions);

  var resources = definitions.map(definition => new Resource({
    version: apiVersion,
    definition,
    db
  }));

  // Configure routes for our resources.
  resources.forEach(resource =>
    router.use(routeBuilder(
      express.Router(),
      resource.routes,
      resource.location
    ))
  );

  router.get('/', (req, res) => {
    log.info({req}, 'A route to the root is being redirected.');
    res.redirect(`/v${apiVersion}`);
  });

  const links = {};
  resources.forEach(r => {
    const supportedActions = _.chain(r.definition.actions)
      .pickBy()
      .map((bool, name) => name)
      .value();

    links[r.definition.plural_form] = {
      href: r.location,
      meta: {
        supported_actions: supportedActions
      }
    };
  });

  // Set up the root route that describes the available endpoints.
  router.get(`/v${apiVersion}`, (req, res) => {
    log.info({req}, 'A request was made to the versioned root.');
    sendJson(res, {
      jsonapi: {
        version: '1.0',
        meta: {
          extensions: []
        }
      },
      meta: {
        api_version: `${apiVersion}`,
      },
      links
    });
  });

  // All other requests get a default 404 error.
  router.use('*', (req, res) => {
    log.info({req}, 'A 404 route was handled.');
    res.status(404);
    sendJson(res, {
      errors: [serverErrors.notFound.body()],
      links: {
        self: req.baseUrl
      }
    });
  });

  return router;
};
