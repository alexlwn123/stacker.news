import { COMMENT_DEPTH_LIMIT, OLD_ITEM_DAYS } from './constants'
import { datePivot } from './time'

export const defaultCommentSort = (pinned, bio, createdAt) => {
  // pins sort by recent
  if (pinned) return 'recent'
  // old items (that aren't bios) sort by top
  if (!bio && new Date(createdAt) < datePivot(new Date(), { days: -OLD_ITEM_DAYS })) return 'top'
  // everything else sorts by hot
  return 'hot'
}

export const isJob = item => typeof item.maxBid !== 'undefined'

// a delete directive preceded by a non word character that isn't a backtick
const deletePattern = /\B@delete\s+in\s+(?<number>\d+)\s+(?<unit>second|minute|hour|day|week|month|year)s?/gi

const deleteMentionPattern = /\B@delete/i

export const hasDeleteMention = (text) => deleteMentionPattern.test(text ?? '')

const getDeleteCommand = (text) => {
  if (!deleteMentionPattern.test(text ?? '')) return { text }
  const match = deletePattern?.exec(text)?.groups
  if (!match?.number || !match?.unit) return { text }
  const timestamp = datePivot(new Date(), { [match.unit]: Number(match.number) })
  return { text, timestamp }
}

export const hasDeleteCommand = (text) => !!getDeleteCommand(text)

/*
 * Match "@schedule in 10 seconds"
 * Groups: {
 *   number: 10,
 *   unit: 'second'
 * }
 *
 * See regex explanation https://regex101.com/r/yNJdjq/1
 */
const scheduleInPattern = /\B@schedule\s+in\s+(?<number>\d+)\s+(?<unit>second|minute|hour|day|week|month|year)s?/i

/*
 * Valid matches:
 *  "@schedule on 2024-02-18T00:37:09.123+04:00"
 *  "@schedule at 2024-02-18T00:37:09+0000"
 *  "@schedule for 2024-02-18T00:37Z"
 *
 * Match "@schedule on 2024-02-18T00:37:09.123+04:00"
 * Groups: {
 *   timestamp: '2024-02-18T00:37:09.123+04:00
 * }
 *
 * See regex explanation https://regex101.com/r/yNJdjq/1
 */
const scheduleOnPattern = /\B@schedule\s+(?:on|at|for)\s+(?<timestamp>\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01]?[0-9]|2[0-3]):(?:[0-5]?[0-9])(?::(?:[0-5]?[0-9](?:.\d*)))?(?:Z|[+-](?:[01]?[0-9]|2[0-3]):?(?:[0-5]?[0-9])))/i

/**
 * Convert "@schedule in" mentions to "@schedule on" mentions
 *
 * @param {string} text
 * @returns {{text: string, timestamp: Date | undefined}} modified text and timestamp if found
 */
export const prepareScheduleMention = (text) => {
  if (!scheduleOnPattern.test(text) && !scheduleInPattern.test(text)) return { text }

  const scheduleOnDate = getScheduleDate(text)
  if (scheduleOnDate) return { text, timestamp: scheduleOnDate }

  const match = scheduleInPattern?.exec(text)?.groups
  if (!match?.number || !match?.unit) return { text }

  const timestamp = datePivot(new Date(), { [match.unit]: Number(match.number) })
  const replacedText = text.replace(scheduleInPattern, `@schedule on ${timestamp.toISOString()}`)
  return { text: replacedText, timestamp }
}

/**
 * Finds and parses delete mention
 * @param {string} text
 * @returns {{text: string, timestamp: Date | undefined}} unmodified text and timestamp if found
 */
export const ensureDeleteMention = (text) => {
  if (!deleteMentionPattern.test(text ?? '')) return { text }

  const match = deletePattern?.exec(text)?.groups
  if (!match?.number || !match?.unit) return { text }
  const timestamp = datePivot(new Date(), { [match.unit]: Number(match.number) })
  return { text, timestamp }
}

/**
 * Pull the schedule date from the @schedule on date
 * @param {string} text
 * @returns {Date | false}
 */
const getScheduleDate = (text) => {
  if (!text || !scheduleOnPattern.test(text)) return false
  const match = scheduleOnPattern.exec(text)
  if (!match || !match?.timestamp) return false
  return new Date(match.timestamp)
}

export const enqueueDeletionJob = async (item, models) => {
  const deleteCommand = getDeleteCommand(item.text)
  const time = deleteCommand?.timestamp?.getTime()
  console.log('enqueing delete', deleteCommand, time)
  if (!time) return false
  await models.$queryRawUnsafe(`
    INSERT INTO pgboss.job (name, data, startafter)
    VALUES ('deleteItem', jsonb_build_object('id', ${item.id}), to_timestamp(${time / 1000.0}));`)
}

export const enqueueScheduleJob = async (item, models) => {
  const time = item?.scheduledAt?.getTime()
  console.log('enqueing schedule', item, time)
  if (!time) return false
  await models.$queryRawUnsafe(`
    INSERT INTO pgboss.job (name, data, startafter)
    VALUES ('postItem', jsonb_build_object('id', ${item.id}), to_timestamp(${time / 1000.0}));`)
}

export const deleteItemByAuthor = async ({ models, id, item }) => {
  if (!item) {
    item = await models.item.findUnique({ where: { id: Number(id) } })
  }
  if (!item) {
    console.log('attempted to delete an item that does not exist', id)
    return
  }
  const updateData = { deletedAt: new Date() }
  if (item.text) {
    updateData.text = '*deleted by author*'
  }
  if (item.title) {
    updateData.title = 'deleted by author'
  }
  if (item.url) {
    updateData.url = null
  }
  if (item.pollCost) {
    updateData.pollCost = null
  }

  return await models.item.update({ where: { id: Number(id) }, data: updateData })
}

export const commentSubTreeRootId = (item) => {
  const path = item.path.split('.')
  return path.slice(-(COMMENT_DEPTH_LIMIT - 1))[0]
}
