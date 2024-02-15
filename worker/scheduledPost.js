import { postScheduledItem } from '../lib/item.js'

export async function postItem ({ data: { id }, models }) {
  console.log('Posting scheduled item', id)
  await postScheduledItem({ models, id })
}
