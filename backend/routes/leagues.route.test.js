'use strict'
const path = require('path')
process.env.DB_PATH = path.join(__dirname, '..', 'test.sqlite')

const { seed } = require('../scripts/seed-test-db')
const { getClubDomain } = require('./leagues')._test
const { getDb } = require('../db/schema')

beforeAll(() => {
  seed(process.env.DB_PATH)
})

describe('leagues route — getClubDomain', () => {
  it('falls back to whcc.play-cricket.com when clubId is null', () => {
    expect(getClubDomain(getDb(), null)).toBe('whcc.play-cricket.com')
  })

  it('falls back to whcc.play-cricket.com when the club has no domain set', () => {
    expect(getClubDomain(getDb(), 999999)).toBe('whcc.play-cricket.com')
  })
})
