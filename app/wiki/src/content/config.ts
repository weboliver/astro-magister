import { defineCollection, z } from 'astro:content'

const wikiCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    section: z.string().optional(),
    category: z.string().optional(),
    categorySlug: z.string().optional(),
    date: z.string().optional(),
    draft: z.boolean().optional().default(false),
  }),
})

export const collections = {
  wiki: wikiCollection,
}