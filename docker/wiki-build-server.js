#!/usr/bin/env node
const http = require('http')
const { execSync } = require('child_process')

const PORT = 9000
const WIKI_DIR = '/workspace/app/wiki'

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/build') {
    try {
      execSync('npm install --legacy-peer-deps', { cwd: WIKI_DIR, stdio: 'pipe' })
      const buildOutput = execSync('npm run build', {
        cwd: WIKI_DIR,
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', output: buildOutput.slice(-2000) }))
    } catch (e) {
      const output = e.stdout ? e.stdout.slice(-2000) : ''
      const errMsg = e.stderr ? e.stderr.slice(-2000) : e.message
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: errMsg || e.message, output: output }))
    }
  } else {
    res.writeHead(404)
    res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Wiki build server listening on ${PORT}`)
})