const path = require('path');
const request = require('supertest');
const app = require('../../../packages/api-pls-express-server/app');
const getDb = require('../../../packages/api-pls-postgres-adapter/database');
const wipeDatabase = require('../../../packages/api-pls-postgres-adapter/database/wipe');
const validators = require('../../helpers/json-api-validators');
const applyMigrations = require('../../helpers/apply-migrations');

const db = getDb();
const fixturesDirectory = path.join(__dirname, '..', '..', 'fixtures');

describe('Resource DELETE failure', function() {
  // Ensure that the DB connection drops immediately after each test
  afterEach(() => {
    db.$config.pgp.end();
  });

  // Ensure that there's no lingering data between tests by wiping the
  // database before each test.
  beforeEach(() => {
    return wipeDatabase(db);
  });

  describe('when the resource does not exist', () => {
    it('should return a Not Found error response', async () => {
      const options = {
        resourcesDirectory: path.join(fixturesDirectory, 'empty-resources'),
        apiVersion: 2
      };

      const expectedErrors = [{
        title: 'Resource Not Found',
        detail: 'The requested resource does not exist.'
      }];

      await applyMigrations(options);
      return request(app(options))
        .delete('/v2/pastas/1')
        .expect(validators.basicValidation)
        .expect(validators.assertErrors(expectedErrors))
        .expect(404)
        .then();
    });
  });

  describe('attempting to DELETE an entire list of resources', () => {
    it('should return a Method Not Allowed error response', async () => {
      const options = {
        resourcesDirectory: path.join(fixturesDirectory, 'kitchen-sink'),
        apiVersion: 1
      };

      const expectedErrors = [{
        title: 'Method Not Allowed',
        detail: 'This method is not permitted on this resource.'
      }];

      await applyMigrations(options);
      return request(app(options))
        .delete('/v1/nopes')
        .expect(validators.basicValidation)
        .expect(validators.assertErrors(expectedErrors))
        .expect(405)
        .then();
    });
  });
});
