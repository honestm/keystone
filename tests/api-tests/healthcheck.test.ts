import { list } from '@keystone-6/core'
import { allowAll } from '@keystone-6/core/access'
import { text } from '@keystone-6/core/fields'
import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { testConfig } from './utils'

const makeRunner = (healthCheck: any) =>
  setupTestRunner({
    config: testConfig({
      lists: {
        User: list({
          access: allowAll,
          fields: {
            name: text()
          }
        }),
      },
      server: { healthCheck },
    }),
    serve: true
  })

test(
  'No health check',
  makeRunner(undefined)(async ({ http }) => {
    await http().get('/_healthcheck').set('Accept', 'application/json').expect(404)
  })
)

test(
  'Default health check',
  makeRunner(true)(async ({ http }) => {
    const { text } = await http()
      .get('/_healthcheck')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
    expect(JSON.parse(text)).toEqual({
      status: 'pass',
      timestamp: expect.any(Number),
    })
  })
)

test(
  'Custom path',
  makeRunner({ path: '/custom' })(async ({ http }) => {
    const { text } = await http()
      .get('/custom')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
    expect(JSON.parse(text)).toEqual({
      status: 'pass',
      timestamp: expect.any(Number),
    })
  })
)

test(
  'Custom data: object',
  makeRunner({ data: { foo: 'bar' } })(async ({ http }) => {
    const { text } = await http()
      .get('/_healthcheck')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
    expect(JSON.parse(text)).toEqual({ foo: 'bar' })
  })
)

test(
  'Custom data: function',
  makeRunner({ data: () => ({ foo: 'bar' }) })(async ({ http }) => {
    const { text } = await http()
      .get('/_healthcheck')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
    expect(JSON.parse(text)).toEqual({ foo: 'bar' })
  })
)
