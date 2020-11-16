let aws = require('aws-sdk')
let { join } = require('path')
let { existsSync } = require('fs')
let waterfall = require('run-waterfall')
let { fingerprint: fingerprinter, toLogicalID, updater } = require('@architect/utils')
let { config: fingerprintConfig } = fingerprinter
let publish = require('./publish')
let getResources = require('../utils/get-cfn-resources')

/**
 * Upload files to CFN defined bucket
 *
 * @param {Object} params - parameters object
 * @param {Function} callback - a node-style errback
 * @returns {Promise} - if no callback is supplied
 */
module.exports = function deployStatic (inventory, params, callback) {
  let {
    bucket: Bucket,
    credentials,
    isDryRun = false,
    isFullDeploy = true, // Prevents duplicate static manifest operations that could impact state
    name,
    production,
    region,
    stackname,
    update,
    verbose,
    // `@static` settings
    prefix, // Enables `@static prefix` publishing prefix (not the same as `@static folder`)
    prune = false,
  } = params
  if (!update) update = updater('Deploy')

  if (isDryRun) {
    // TODO implement static deploy dry run?
    update.status('Static dry run not yet available, skipping static deploy...')
    callback()
  }
  else {
    update.status('Deploying static assets...')
    let { inv } = inventory
    let appname = inv.app

    if (!stackname) {
      stackname = `${toLogicalID(appname)}${production ? 'Production' : 'Staging'}`
      if (name) stackname += toLogicalID(name)
    }

    waterfall([
      // Parse settings
      function (callback) {
        // Bail early if this project doesn't have @static specified
        if (!inv.static) callback(Error('cancel'))
        else {
          // Fingerprinting + ignore any specified files
          let { fingerprint, ignore } = fingerprintConfig(inv._project.arc)

          // Asset pruning: delete files not present in public/ folder
          prune = prune || inv.static.prune

          // Project folder remap
          let folder = inv.static.folder
          if (!existsSync(join(process.cwd(), folder))) {
            callback(Error('@static folder not found'))
          }
          else {
            // Published path prefixing
            prefix = prefix || inv.static.prefix
            callback(null, { fingerprint, ignore, folder })
          }
        }
      },

      // Get the bucket PhysicalResourceId if not supplied
      function (params, callback) {
        if (!Bucket) {
          getResources({ credentials, region, stackname }, function (err, resources) {
            if (err) callback(err)
            else {
              let find = i => i.ResourceType === 'AWS::S3::Bucket' && i.LogicalResourceId === 'StaticBucket'
              Bucket = resources.find(find).PhysicalResourceId
              callback(null, params)
            }
          })
        }
        else callback(null, params)
      },

      function ({ fingerprint, ignore, folder }, callback) {
        let config = { region }
        if (credentials) config.credentials = credentials
        let s3 = new aws.S3(config)

        publish({
          Bucket,
          fingerprint,
          folder,
          ignore,
          isFullDeploy,
          prefix,
          prune,
          region,
          s3,
          update,
          verbose,
        }, callback)
      }
    ],
    function done (err) {
      if (err && err.message === 'cancel') callback()
      else if (err) callback(err)
      else callback()
    })
  }
}
