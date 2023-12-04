import path from 'path'
import fs from 'fs/promises'
import { readdirSync } from 'fs'
import os from 'os'
import {
  createDatabase,
  getConfig,
  getDMMF,
  parseEnvValue,
  printConfigWarnings,
} from '@prisma/internals'
import { getPrismaClient, objectEnumValues } from '@prisma/client/runtime/library'
// @ts-expect-error
import { externalToInternalDmmf } from '@prisma/client/generator-build'
import {
  initConfig,
  createSystem,
  createExpressServer
} from '@keystone-6/core/system'
import supertest, { type Test } from 'supertest'
import type { BaseKeystoneTypeInfo, KeystoneConfig, KeystoneContext } from '@keystone-6/core/types'
import {
  getCommittedArtifacts,
  type PrismaModule,
} from '@keystone-6/core/___internal-do-not-use-will-break-in-patch/artifacts'
import prismaClientPackageJson from '@prisma/client/package.json'
import { runMigrateWithDbUrl, withMigrate } from '../../packages/core/src/lib/migrations'
import { dbProvider, dbUrl, SQLITE_DATABASE_FILENAME } from './utils'

// you could call this a memory leak but it ends up being fine
// because we're only going to run this on a reasonably small number of schemas and then exit
const prismaModuleCache = new Map<string, PrismaModule>()

// a modified version of https://github.com/prisma/prisma/blob/bbdf1c23653a77b0b5bf7d62efd243dcebea018b/packages/client/src/utils/getTestClient.ts
// yes, it's totally relying on implementation details
// we're okay with that because otherwise the performance of our tests is very bad
const tmpdir = os.tmpdir()

const prismaSchemaDirectory = path.join(tmpdir, Math.random().toString(36).slice(2))

const prismaSchemaPath = path.join(prismaSchemaDirectory, 'schema.prisma')

const prismaEnginesDir = path.dirname(require.resolve('@prisma/engines/package.json'))

const prismaEnginesDirEntries = readdirSync(prismaEnginesDir)

const queryEngineFilename = prismaEnginesDirEntries.find(dir => dir.startsWith('libquery_engine'))

if (!queryEngineFilename) {
  throw new Error('Could not find query engine')
}

process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(prismaEnginesDir, queryEngineFilename)

async function getTestPrismaModuleInner (schema: string) {
  const config = await getConfig({ datamodel: schema, ignoreEnvVarErrors: true })
  printConfigWarnings(config.warnings)

  const generator = config.generators.find(g => parseEnvValue(g.provider) === 'prisma-client-js')

  const document = externalToInternalDmmf(
    await getDMMF({ datamodel: schema, previewFeatures: [] })
  )
  const activeProvider = config.datasources[0].activeProvider
  const options: Parameters<typeof getPrismaClient>[0] = {
    document,
    generator,
    dirname: prismaSchemaDirectory,
    relativePath: '',
    clientVersion: prismaClientPackageJson.version,
    engineVersion: 'engine-test-version',
    relativeEnvPaths: {},
    datasourceNames: config.datasources.map(d => d.name),
    activeProvider,
    dataProxy: false,
  }
  return {
    PrismaClient: getPrismaClient(options) as any,
    Prisma: {
      DbNull: objectEnumValues.instances.DbNull,
      JsonNull: objectEnumValues.instances.JsonNull,
    },
  }
}

async function getTestPrismaModule (schema: string) {
  if (prismaModuleCache.has(schema)) return prismaModuleCache.get(schema)!
  return prismaModuleCache.set(schema, await getTestPrismaModuleInner(schema)).get(schema)!
}

afterAll(async () => {
  await fs.rm(prismaSchemaDirectory, { recursive: true, force: true })
})

let hasCreatedDatabase = false

async function pushSchemaToDatabase (schema: string) {
  if (dbProvider === 'sqlite') {
    // touch the file (or truncate it), easiest way to start from scratch
    await fs.writeFile(path.join(prismaSchemaDirectory, SQLITE_DATABASE_FILENAME), '')
    await withMigrate(prismaSchemaPath, migrate =>
      runMigrateWithDbUrl(dbUrl, undefined, () =>
        migrate.engine.schemaPush({
          force: true,
          schema,
        })
      )
    )
    return
  }
  let justCreatedDatabase = hasCreatedDatabase
    ? false
    : await createDatabase(dbUrl, prismaSchemaDirectory)
  await withMigrate(prismaSchemaPath, async migrate => {
    if (!justCreatedDatabase) {
      await runMigrateWithDbUrl(dbUrl, undefined, () => migrate.reset())
    }
    await runMigrateWithDbUrl(dbUrl, undefined, () =>
      migrate.engine.schemaPush({
        force: true,
        schema,
      })
    )
  })
  hasCreatedDatabase = true
}

let lastWrittenSchema = ''

export async function setupTestEnv<TypeInfo extends BaseKeystoneTypeInfo> (
  config_: KeystoneConfig<TypeInfo>
) {
  // UI is always disabled
  const config = initConfig({
    ...config_,
    ui: { ...config_.ui, isDisabled: true },
  })

  const { graphQLSchema, getKeystone } = createSystem(config)
  const artifacts = await getCommittedArtifacts(config, graphQLSchema)

  if (lastWrittenSchema !== artifacts.prisma) {
    if (!lastWrittenSchema) {
      await fs.mkdir(prismaSchemaDirectory, { recursive: true })
    }
    await fs.writeFile(prismaSchemaPath, artifacts.prisma)
  }
  await pushSchemaToDatabase(artifacts.prisma)
  return getKeystone(await getTestPrismaModule(artifacts.prisma))
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
