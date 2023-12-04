import { type IncomingMessage, type ServerResponse } from 'http'
import { list } from '@keystone-6/core'
import { text } from '@keystone-6/core/fields'
import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { allowAll } from '@keystone-6/core/access'
import { testConfig } from './utils'

const runner = setupTestRunner({
  config: testConfig({
    lists: {
      User: list({
        access: allowAll,
        fields: {
          name: text()
        },
      }),
    },
    server: {
      extendHttpServer: server => {
        server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader('test-header', 'test-header-value')
        })
      },
    },
  }),
  serve: true
})

test(
  'server extension',
  runner(async ({ http }) => {
    await http().get('/anything').expect('test-header', 'test-header-value')
  })
)
