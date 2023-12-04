import { type KeystoneContext } from '@keystone-6/core/types'
import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { text, relationship, integer } from '@keystone-6/core/fields'
import { list } from '@keystone-6/core'
import { allowAll } from '@keystone-6/core/access'
import { testConfig } from '../utils'

const runner = setupTestRunner({
	config: testConfig({
		lists: {
			Post: list({
				access: allowAll,
				fields: {
					order: integer({ isIndexed: 'unique' }),
					author: relationship({ ref: 'User.posts', many: true }),
				},
			}),
			User: list({
				access: allowAll,
				fields: {
					name: text(),
					posts: relationship({ ref: 'Post.author', many: true }),
				},
			}),
		},
	})
})

async function seed (context: KeystoneContext) {
  const result = await context.query.User.createOne({
    data: {
      name: 'Test',
      posts: {
        create: Array.from(Array(15).keys()).map(num => ({ order: num })),
      },
    },
    query: 'id posts { id order }',
  })

  // posts will be added in random sequence, we order them for deterministic results
  const posts = result.posts.sort((a: { order: number }, b: { order: number }) => a.order - b.order)
  return {
    userId: result.id,
    posts
  }
}

describe('cursor pagination basic tests', () => {
  test('cursor pagination test (graphql api)', runner(async ({ context }) => {
		const { posts } = await seed(context)

    const { errors, data } = await context.graphql.raw({
      query: `query { posts(
          take: 6,\
          skip: 1,\
          cursor: { order: 5 }\
          orderBy: { order: asc }\
        ) { id order }\
      }`,
    })
    expect(errors).toEqual(undefined)
    let currentOrder = 6
    expect(data).toEqual({
      posts: Array.from(Array(6).keys()).map(_ => posts[currentOrder++]),
    })
  }))

  test('cursor pagination test (query api)', runner(async ({ context }) => {
		const { posts } = await seed(context)

    const result1 = await context.query.Post.findMany({
      take: 6,
      skip: 1,
      cursor: { order: 5 },
      orderBy: { order: 'asc' },
      query: 'id order',
    })
    expect(result1).toBeDefined()
    expect(result1.length).toBe(6)
    let currentOrder = 6
    expect(result1).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder++]))
  }))

  test('cursor pagination test (db api)', runner(async ({ context }) => {
		const { posts } = await seed(context)

    const result1 = await context.db.Post.findMany({
      take: 6,
      skip: 1,
      cursor: { order: 5 },
      orderBy: { order: 'asc' },
    })
    expect(result1).toBeDefined()
    expect(result1.length).toBe(6)
    let currentOrder = 6
    expect(result1).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder++]))
  }))

  test('cursor pagination through relation', runner(async ({ context }) => {
		const { userId, posts } = await seed(context)

    const { errors, data } = await context.graphql.raw({
      query: `query {\
        user(where: { id: "${userId}"}) {\
          posts(\
            take: 6,\
            skip: 1,\
            cursor: { order: 5 }\
            orderBy: { order: asc }\
          ) { id order }\
        }\
      }`,
    })
    expect(errors).toEqual(undefined)
    let currentOrder = 6
    expect(data).toEqual({
      user: { posts: Array.from(Array(6).keys()).map(_ => posts[currentOrder++]) },
    })
  }))

  test('cursor pagination forward', runner(async ({ context }) => {
		const { posts } = await seed(context)

    const result1 = await context.query.Post.findMany({
      take: 6,
      orderBy: { order: 'asc' },
      query: 'id order',
    })
    expect(result1).toBeDefined()
    let currentOrder = 0
    expect(result1).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder++]))

    const result2 = await context.query.Post.findMany({
      take: 6,
      skip: 1,
      cursor: { order: result1[result1.length - 1].order },
      orderBy: { order: 'asc' },
      query: 'id order',
    })

    expect(result2).toBeDefined()
    expect(result2).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder++]))

    const result3 = await context.query.Post.findMany({
      take: 6,
      skip: 1,
      cursor: { order: result2[result2.length - 1].order },
      orderBy: { order: 'asc' },
      query: 'id order',
    })

    expect(result3).toBeDefined()
    expect(result3).toEqual(Array.from(Array(3).keys()).map(_ => posts[currentOrder++]))
  }))

  test('cursor pagination backwards', runner(async ({ context }) => {
		const { posts } = await seed(context)

    const result1 = await context.query.Post.findMany({
      take: -6,
      orderBy: { order: 'desc' },
      query: 'id order',
    })
    expect(result1).toBeDefined()
    let currentOrder = 5
    expect(result1).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder--]))

    const result2 = await context.query.Post.findMany({
      take: -6,
      skip: 1,
      cursor: { order: result1[0].order },
      orderBy: { order: 'desc' },
      query: 'id order',
    })

    expect(result2).toBeDefined()
    currentOrder = 11
    expect(result2).toEqual(Array.from(Array(6).keys()).map(_ => posts[currentOrder--]))

    const result3 = await context.query.Post.findMany({
      take: -6,
      skip: 1,
      cursor: { order: result2[0].order },
      orderBy: { order: 'desc' },
      query: 'id order',
    })

    expect(result3).toBeDefined()
    currentOrder = 14
    expect(result3).toEqual(Array.from(Array(3).keys()).map(_ => posts[currentOrder--]))
  }))
})

describe('cursor pagination stability', () => {
  test('insert rows in the middle of pagination and check stability', runner(async ({ context }) => {
    const { posts } = await seed(context)

    const result1 = await context.query.Post.findMany({
      take: 3,
      skip: 1,
      cursor: { order: 13 },
      orderBy: { order: 'desc' },
      query: 'id order',
    })
    expect(result1).toBeDefined()
    let currentOrder = 12
    expect(result1).toEqual(Array.from(Array(3).keys()).map(_ => posts[currentOrder--]))

    await context.query.Post.createMany({
      data: [{ order: 15 }, { order: 16 }, { order: 17 }, { order: 18 }],
    })

    const result2 = await context.query.Post.findMany({
      take: 3,
      skip: 1,
      cursor: { order: result1[result1.length - 1].order },
      orderBy: { order: 'desc' },
      query: 'id order',
    })
    expect(result2).toBeDefined()
    currentOrder = 9
    expect(result2).toEqual(Array.from(Array(3).keys()).map(_ => posts[currentOrder--]))
  }))
})
