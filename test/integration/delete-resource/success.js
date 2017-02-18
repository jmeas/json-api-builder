const path = require('path');
const request = require('supertest');
const app = require('../../../server/app');
const getDb = require('../../../lib/database');
const seed = require('../../helpers/seed');
const wipeDatabase = require('../../../lib/wipe-database');
const validators = require('../../helpers/json-api-validators');
const applyMigrations = require('../../helpers/apply-migrations');

const db = getDb();
const fixturesDirectory = path.join(__dirname, '..', '..', 'fixtures');

describe('Resource DELETE success', function() {
  // Ensure that the DB connection drops immediately after each test
  afterEach(() => {
    db.$config.pgp.end();
  });

  // Ensure that there's no lingering data between tests by wiping the
  // database before each test.
  beforeEach(done => {
    wipeDatabase(db).then(() => done());
  });

  describe('when the request succeeds', () => {
    beforeEach((done) => {
      this.options = {
        resourcesDirectory: path.join(fixturesDirectory, 'kitchen-sink'),
        apiVersion: 10
      };

      const seeds = [{
        label: 'sandwiches',
        size: 'M'
      }];

      applyMigrations(this.options)
        .then(() => seed('nope', seeds))
        .then(() => done());
    });

    it('should return a 204 response', (done) => {
      request(app(this.options))
        .delete('/v10/nopes/1')
        .expect(validators.assertEmptyBody)
        .expect(204)
        .end(done);
    });
  });
});