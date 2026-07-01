'use strict'

const multer = require('multer')
const { getAuthContext } = require('../../middleware/auth')
const { VALID_TAGS, syncFixtureTags, tagsFromCompetition } = require('../../utils/tags')

function getAdminMeta(req) {
  const ctx = getAuthContext(req)
  return { isSuperAdmin: ctx.isSuperAdmin, isClubAdmin: ctx.isClubAdmin, groups: ctx.groups }
}
function canManageUsers(req) {
  const m = getAdminMeta(req)
  return m.isSuperAdmin || m.isClubAdmin
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

module.exports = {
  getAdminMeta,
  canManageUsers,
  upload,
  VALID_TAGS,
  syncFixtureTags,
  tagsFromCompetition
}
