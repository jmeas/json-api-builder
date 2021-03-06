'use strict';

const pgp = require('pg-promise')({
  capSQL: true
});
const dbConfig = require('./config');

let db;

// This module exports a singleton of the DB. It lets you pass in options to
// configure how the interaction with the DB will go.
module.exports = function(options) {
  if (db) {
    return db;
  }

  db = pgp(dbConfig(options));

  return db;
};
