import { list } from '@keystone-6/core'
import { allowAll } from '@keystone-6/core/access'
import { text } from '@keystone-6/core/fields'
import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { testConfig } from './utils'

const runner = setupTestRunner({
  config: testConfig({
    lists: {
      User: list({
        access: allowAll,
        fields: {
          name: text()
        }
      }),
    },
    server: {
      extendExpressApp: app => {
        app.get('/magic', (req, res) => {
          res.json({ magic: true })
        })
      },
    },
  }),
  serve: true
})

test(
  'basic extension',
  runner(async ({ http }) => {
    const { text } = await http()
      .get('/magic')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)

    expect(JSON.parse(text)).toEqual({
      magic: true,
    })
  })
)
