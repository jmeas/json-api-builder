const path = require('path');
const request = require('supertest');
const app = require('../../../../packages/api-pls-express-server/app');
const getDb = require('../../../../packages/api-pls-postgres-adapter/database');
const wipeDatabase = require('../../../../packages/api-pls-postgres-adapter/database/wipe');
const validators = require('../../../helpers/json-api-validators');
const applyMigrations = require('../../../helpers/apply-migrations');
const seed = require('../../../helpers/seed');

const db = getDb();

describe('Resource PATCH success, many-to-one (host)', function() {
  // Ensure that the DB connection drops immediately after each test
  afterEach(() => {
    db.$config.pgp.end();
  });

  // Ensure that there's no lingering data between tests by wiping the
  // database before each test.
  beforeEach(() => {
    return wipeDatabase(db);
  });

  describe('when the request is valid, with a relationship', () => {
    it('should return a 200 OK, with the updated resource', async () => {
      const options = {
        resourcesDirectory: path.join(global.fixturesDirectory, 'many-to-one'),
        apiVersion: 24
      };

      const personSeeds = [
        {first_name: 'sandwiches'},
        {first_name: 'what'},
        {first_name: 'pls'}
      ];

      const catSeeds = [
        {name: 'james', owner_id: '1'}
      ];

      const expectedData = {
        type: 'cats',
        id: '1',
        attributes: {
          name: 'james'
        },
        relationships: {
          owner: {
            data: {
              id: '3',
              type: 'people'
            },
            links: {
              self: '/v24/cats/1/relationships/owner',
              related: '/v24/cats/1/owner'
            }
          }
        }
      };

      const expectedLinks = {
        self: '/v24/cats/1'
      };

      await applyMigrations(options);
      await seed('person', personSeeds);
      await seed('cat', catSeeds);
      return request(app(options))
        .patch('/v24/cats/1')
        .send({
          data: {
            id: '1',
            type: 'cats',
            relationships: {
              owner: {
                data: {
                  id: '3',
                  type: 'people'
                }
              }
            }
          }
        })
        .expect(validators.basicValidation)
        .expect(validators.assertData(expectedData))
        .expect(validators.assertLinks(expectedLinks))
        .expect(200)
        .then();
    });
  });
});
