import fs from 'node:fs/promises'
import path from 'node:path'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  getConfig,
  getDMMF,
  parseEnvValue,
  printConfigWarnings,
} from '@prisma/internals'
import { getPrismaClient, objectEnumValues } from '@prisma/client/runtime/library'
import {
  externalToInternalDmmf
// @ts-expect-error
} from '@prisma/client/generator-build'

import {
  initConfig,
  createSystem,
  createExpressServer
} from '@keystone-6/core/system'
import supertest, { type Test } from 'supertest'
import type { BaseKeystoneTypeInfo, KeystoneConfig, KeystoneContext } from '@keystone-6/core/types'
import { generatePrismaAndGraphQLSchemas, type PrismaModule } from '@keystone-6/core/___internal-do-not-use-will-break-in-patch/artifacts'
import { runMigrateWithDbUrl, withMigrate } from '../../packages/core/src/lib/migrations'

// PRISMA
{
  const prismaEnginesDir = path.dirname(require.resolve('@prisma/engines/package.json'))
  const prismaEnginesDirEntries = readdirSync(prismaEnginesDir)
  const queryEngineFilename = prismaEnginesDirEntries.find(dir => dir.startsWith('libquery_engine'))
  if (!queryEngineFilename) throw new Error('Could not find query engine')
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(prismaEnginesDir, queryEngineFilename)
}
// PRISMA

// somewhat equivalent to https://github.com/prisma/prisma/blob/main/packages/client/src/utils/getTestClient.ts
//   ?except without a redundant directory?
async function getTestPrismaModuleInner (prismaSchemaPath: string, datamodel: string) {
  const config = await getConfig({ datamodel, ignoreEnvVarErrors: true })
  printConfigWarnings(config.warnings)

  const generator = config.generators.find(g => parseEnvValue(g.provider) === 'prisma-client-js')
  const document = await getDMMF({ datamodel, previewFeatures: [] })
  const activeProvider = config.datasources[0].activeProvider

  return {
    PrismaClient: getPrismaClient({
      document: externalToInternalDmmf(document),
      generator,
      dirname: path.dirname(prismaSchemaPath),
      relativePath: '',

      clientVersion: '0.0.0',
      engineVersion: '0000000000000000000000000000000000000000',
      relativeEnvPaths: {},

      datasourceNames: config.datasources.map(d => d.name),
      activeProvider,
      dataProxy: false,
    }) as any,
    Prisma: {
      DbNull: objectEnumValues.instances.DbNull,
      JsonNull: objectEnumValues.instances.JsonNull,
    },
  }
}

const prismaModuleCache = new Map<string, PrismaModule>()
async function getTestPrismaModule (prismaSchemaPath: string, schema: string) {
  if (prismaModuleCache.has(schema)) return prismaModuleCache.get(schema)!
  return prismaModuleCache.set(schema, await getTestPrismaModuleInner(prismaSchemaPath, schema)).get(schema)!
}

const deferred: (() => Promise<void>)[] = []
afterAll(async () => {
  for (const f of deferred) {
    await f()
  }
})

async function testConfig2<TypeInfo extends BaseKeystoneTypeInfo> (config: KeystoneConfig<TypeInfo>) {
  const tmp = join(tmpdir(), `ks6-tests-${randomBytes(8).toString('base64url')}`)
  await fs.mkdir(tmp)
  deferred.push(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  return initConfig({
    types: {
      path: join(tmp, 'test-types.ts')
    },
    ...config,
    db: {
      ...config.db,
      // see api-tests/utils.ts
      url: config.db.url === 'file:./test.db' ? `file:${join(tmp, 'test.db')}` : config.db.url,
      prismaClientPath: join(tmp, '.client'),
      prismaSchemaPath: join(tmp, 'schema.prisma'),
    },
    graphql: {
      schemaPath: join(tmp, 'schema.graphql'),
      ...config.graphql,
    }
  })
}

export async function setupTestEnv<TypeInfo extends BaseKeystoneTypeInfo> (
  config_: KeystoneConfig<TypeInfo>
) {
  const config = await testConfig2(config_)
  const { graphQLSchema, getKeystone } = createSystem(config)
  const artifacts = await generatePrismaAndGraphQLSchemas('', config, graphQLSchema)

  // setup (reset) the database
  await withMigrate(config.db.prismaSchemaPath, async migrate => {
    await runMigrateWithDbUrl(config.db.url, undefined, () => migrate.reset())

    return await runMigrateWithDbUrl(config.db.url, undefined, () => {
      return migrate.engine.schemaPush({
        force: true,
        schema: artifacts.prisma,
      })
    })
  })

  return getKeystone(await getTestPrismaModule(config.db.prismaSchemaPath, artifacts.prisma))
}

type GQLArgs = {
  query: string
  variables?: Record<string, any>
  operationName?: string
}
type GQLRequest = (args: GQLArgs, headers?: Record<string, string>) => Test

export function setupTestRunner<TypeInfo extends BaseKeystoneTypeInfo> ({
  config,
  serve = false,
}: {
  config: KeystoneConfig<TypeInfo>
  serve?: boolean // otherwise, we mock
}) {
  return (testFn: (args: {
    context: KeystoneContext<TypeInfo>
    config: KeystoneConfig<TypeInfo>
    http: () => (ReturnType<typeof supertest>)
    gql: GQLRequest
  }) => Promise<void>) => async () => {
    const { connect, disconnect, context } = await setupTestEnv(config)
    await connect()

    if (serve) {
      const {
        expressServer: app,
      } = await createExpressServer(config, context.graphql.schema, context)

      function http () {
        return supertest(app)
      }

      function gql ({
        query,
        variables = undefined,
        operationName
      }: GQLArgs) {
        return http()
          .post(config.graphql?.path ?? '/api/graphql')
          .send({ query, variables, operationName })
          .set('Accept', 'application/json')
      }

      try {
        return await testFn({ context, config, http, gql })
      } finally {
        await disconnect()
      }
    }

    function noop (): never { throw new Error('Not supported') }
    async function gql ({
      query,
      variables = undefined,
      operationName
    }: GQLArgs) {
      const { data, errors } = await context.graphql.raw({ query, variables })
      return {
        body: { data, errors }
      }
    }

    try {
      return await testFn({
        context,
        config,
        http: noop,
        gql: gql as any // TODO: uh
      })
    } finally {
      await disconnect()
    }
  }
}
