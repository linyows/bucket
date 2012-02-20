/**
     __                              __                    __
    /  /__     ___   ___  ________  /  / ___   ______   __/  /_
   /  __   \  /  /  /  / /  _____/ /  / ___/ /  ___  \ /_    _/
  /  /__/  / /  /__/  / /  /____  /     \   /  /_____/  /  /
 /________/  \____\__/ /_______/ /__/ \__\  \_______/  /__/

 * Resource controll server for AmazonS3 on node.js.
 *
 * @version 0.1.1
 * @copyright 2012 linyows
 * @author linyows <hello@linyo.ws>
 * @license linyows {@link http://linyo.ws/}
 */

/**
 * Module dependencies
 */
var conf       = require('config');
var validator  = require('validator');
var knox       = require('knox');
var formidable = require('formidable');
var im         = require('imagemagick');
var http       = require('http');
var https      = require('https');
var fs         = require('fs');
var http       = require('http');
var util       = require('util');
var qs         = require('querystring');
var cr         = require('crypto');
var ur         = require('url');

/**
 * Setting
 */
var debug = false;
var name  = 'bucket';

/**
 * Validate init
 */
var Validator = validator.Validator;
Validator.prototype.error = function(msg){ this._errors.push(msg); }
Validator.prototype.getErrors = function(){ return this._errors; }
var v = new Validator();

/**
 * Create server
 */
var server = http.createServer(function(req, res) {

  // Parse url
  req.params = parseUrl(req.url);

  switch (true) {
    // Root
    case (req.url === '/'):
      render(req, res, 'ok', {  message: 'Welcome!' });
      break;

    // Options
    // case (req.method === 'OPTIONS'):
      // res.setHeader('Access-Control-Allow-Origin', '*');
      // res.setHeader('Access-Control-Allow-Headers', '*');// X-Requested-With
      // res.setHeader('Access-Control-Allow-Methods', '*');
      // res.setHeader('Access-Control-Allow-Credentials', 'true');
      // render(req, res, 'ok');
      // break;

    // Delete
    case (req.method === 'DELETE'):
    //case (req.method === 'POST' && req.params.method === 'DELETE'):
      break;

    // Upload
    case (req.method === 'POST'):
      (validatePost(req, res) === true) ?  upload(req, res) : render(req, res, 'unprocessable_entity', {  errors: v.getErrors() });
      break;

    default:
      render(req, res, 'not_found');
      break;
  }
});

/**
 * Listen
 */
server.listen(conf.server.port, conf.server.host);

/**
 * Parse URL
 * /:resource_name/:account_id.:format
 *
 * [ '/profile_pictures/4f1c08fc508a257a9e0000ef.json?access_token=afi80dl9azx24',
 *  'profile_pictures',
 *  '4f1c08fc508a257a9e0000ef',
 *  '.json',undefined
 *  'json',undefined
 *  '?access_token=afi80dl9azx24',undefined
 *  'afi80dl9azx24',undefined
 *  index: 0,
 *  input: '/profile_pictures/4f1c08fc508a257a9e0000ef.json?access_token=afi80dl9azx24' ]
 */
function parseUrl(url)
{
  c(url, 'yellow');
  var defaultFormat = 'json';
  var parsedUrl = ur.parse(url);
  var format = parsedUrl.pathname.match(/.*\.(.*)?(\?.*)?/);
  var pathname = parsedUrl.pathname.replace(/\..*/, '').replace(/^\/|\/$/, '').replace(/^resources\//, '').split('/');
  var queries = qs.parse(parsedUrl.query);
  var parsed = {
    path: parsedUrl.path,
    format: (format) ? format[1] : defaultFormat,
    pathname: pathname,
    queries: queries,
    resource_name: (pathname) ? pathname[0] : null,
    account_id: (pathname && pathname[1]) ? pathname[1] : null,
    resource_id: (pathname && pathname[2]) ? pathname[2] : null,
    token: (queries && queries.access_token) ? queries.access_token : null
  }
  c(parsed, 'red');
  return parsed;
}

/**
 * Validate Post
 */
function validatePost(req, res)
{
  v.check(req.params.resource_name, 'Resource name is required.').notNull();
  v.check(req.params.account_id, 'Account id is required.').notNull();
  v.check(req.params.format, 'File format is required.').notNull();
  v.check(req.params.token, 'Token is required.').notNull();
  if (v.getErrors().length) { return false; }

  v.check(req.params.resource_name, 'Resource name is invalid.').isIn(['profile_pictures', 'styles']);
  v.check(req.params.account_id, 'Account id is invalid.').is(/^[0-9a-f]{24}$/);
  v.check(req.params.format, 'File format is invalid.').isIn(['json', 'html']);
  v.check(req.params.token, 'Token is invalid.').is(/^[0-9A-z_-]+$/);
  return (v.getErrors().length) ? false : true;
}

/**
 * Validate Delete
 */
function validateDel(req, res)
{
}

/**
 * Validate Mime
 */
function validateMime(mime)
{
  var images = [ 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/gif' ];
  var audios = [ 'audio/caf', 'audio/x-caf', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'video/mp4',
                 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/aiff', 'audio/x-aiff', 'audio/wav', 'audio/x-wav' ];
  v.check(mime, 'invalid.').isIn(images);
  return (v.getErrors().length) ? false : true;
}

/**
 * Upload
 */
function upload(req, res)
{
  var form = new formidable.IncomingForm();
  form.parse(req);

  var files = [];
  var fields = [];

  form.uploadDir = __dirname + conf.upload.path;
  form.maxFieldsSize = 1024 * 1024 * conf.upload.max_fields_size;

  form.on('field', function(field, value) {
    fields.push([field, value]);
  });

  form.on('file', function(field, file) {
    files.push([field, file]);
  });

  form.on('error', function(err) {
    c('Upload error:', 'red');
    c(err);
    render(req, res, 'internal_server_error');
    return;
  });

  form.on('end', function() {
    // TODO: multiple
    if (debug) {
      c('Upload files:', 'yellow');
      c(files);
    }
    var deployParams = files[0][1];

    // Valid
    if (validateMime(deployParams.type)) {
      deployParams.resource_id = unique();

      // Align the content type & extension
      var fileType = deployFileType(deployParams.type);
      var ext = fileType.extension;
      deployParams.type = fileType.contentType;
      deployParams.s3_path = '/' + req.params.resource_name + '/' + req.params.account_id + '/' + deployParams.resource_id + ext;
      authToken(req, res, deployParams);

    // Invalid
    } else {
      var msg = 'Invalid file type: ' + deployParams.type;
      render(req, res, 'unprocessable_entity', { errors: [msg] });
      fs.unlinkSync(deployParams.path)
      c('Validation error: ' + msg, 'yellow');
    }
  });

  form.on('progress', function(bytesReceived, bytesExpected) {
    var progress = {
      type: 'progress',
      bytesReceived: bytesReceived,
      bytesExpected: bytesExpected
    };
    //c('Processing: ' + bytesReceived + '/' + bytesExpected);
    //c('Uploaded: ' + Math.round(bytesReceived/bytesExpected * 100) + ' %');
  });
}

/**
 * Authentication by token
 */
function authToken(req, res, deployParams)
{
  // TODO: check session from memcached
  // if (authorization) {
    deployToS3(req, res, deployParams);
  // } else {
    // render(req, res, 'unauthorized', { errors: [ 'Access token is unauthorized.' ] });
    // fs.unlinkSync(deployParams.path)
    // c('Unauthorized', 'red');
  // }
}

/**
 * Deploy to S3
 */
function deployToS3(req, res, deployParams)
{
  fs.readFile(deployParams.path, function(err, buf){
    var s3Setting = {
      key: conf.s3.access_key,
      secret: conf.s3.secret_key,
      bucket: conf.s3.bucket.deployment
    }
    var s3Client = knox.createClient(s3Setting);
    var s3Req = s3Client.put(deployParams.s3_path, {
      'Content-Length': deployParams.size,
      'Content-Type': deployParams.type,
      'x-amz-acl': conf.s3.file_acl
    });

    s3Req.on('response', function(s3Res){
      if (200 == s3Res.statusCode) {
        var result = {
          result: 'ok',
          resources: []
        };

        if (deployParams.type.match(/^image\/.*/)) {
          im.identify({data: buf}, function(err, meta) {
            var resources = {
              id: deployParams.resource_id,
              content_type: deployParams.type,
              file_size: deployParams.size,
              width: meta.width,
              height: meta.height
            };
            result.resources.push(resources);
            if (debug) {
              c('Result:', 'yellow');
              c(result);
            }
            render(req, res, 'ok', result);
            fs.unlinkSync(deployParams.path);
          });

        } else {
          var resources = {
            id: deployParams.resource_id,
            content_type: deployParams.type,
            file_size: deployParams.size
          };
          result.resources.push(resources);
          render(req, res, 'ok', result);
          fs.unlinkSync(deployParams.path);
        }

      } else {
        c('Failed to deploy the S3.', 'red');
        c('var conf.s3:', 'yellow');
        c(conf.s3);
        c('var deployParams.s3_path:', 'yellow');
        c(deployParams.s3_path);
        c('var s3Res.statusCode:', 'yellow');
        c(s3Res.statusCode);
        c('var s3Res.headers:', 'yellow');
        c(s3Res.headers);
        render(req, res, 'internal_server_error');
      }
    });

    s3Req.end(buf);
  });
}

/**
 * Get extension and content-type by content-type.
 */
function deployFileType(mime)
{
  var fileType = { extension: '', contentType: mime };
  switch (mime) {
    case 'image/pjpeg':
    case 'image/jpg':
    case 'image/jpe':
    case 'image/jpeg':
      fileType.extension = '.jpg';
      fileType.contentType = 'image/jpeg';
      break;

    case 'image/x-png':
    case 'image/png':
      fileType.extension = '.png';
      fileType.contentType = 'image/png';
      break;

    case 'image/gif':
      fileType.extension = '.gif';
      fileType.contentType = 'image/gif';
      break;

    case 'audio/caf':
      fileType.extension = '.caf';
      break;

    case 'audio/mp4':
    case 'video/mp4':
    case 'audio/aac':
    case 'audio/m4a':
    case 'audio/x-m4a':
      fileType.extension = '.m4a';
      fileType.contentType = 'audio/aac';
      break;

    case 'audio/mpeg':
    case 'audio/mp3':
      fileType.extension = '.mp3';
      fileType.contentType = 'audio/mpeg';
      break;

    case 'audio/aiff':
    case 'audio/x-aiff':
      fileType.extension = '.aiff';
      fileType.contentType = 'audio/aiff';
      break;

    case 'audio/wav':
    case 'audio/x-wav':
      fileType.extension = '.wav';
      fileType.contentType = 'audio/wav';
      break;

    default:
      c('Unknown content-type: ' + mime, 'red');
      break;
  }
  return fileType;
}

/**
 * Get unique id.
 */
function unique()
{
  var randam = Math.floor(Math.random()*1000)
  var date = new Date();
  var time = date.getTime();
  var string = randam + time.toString();
  return cr.createHash('sha1').update(string).digest('hex');
}

/**
 * Util
 */
function c(target, color)
{
  var t = '0';
  switch (color) {
    case 'red':      t = '31';   break;
    case 'b-red':    t = '1;31'; break;
    case 'green':    t = '32';   break;
    case 'b-green':  t = '1;32'; break;
    case 'yellow':   t = '33';   break;
    case 'b-yellow': t = '1;33'; break;
    case 'blue':     t = '34';   break;
    case 'b-blue':   t = '1;34'; break;
    case 'purple':   t = '35';   break;
    case 'b-purple': t = '1;35'; break;
    case 'cyan':     t = '36';   break;
    case 'b-cyan':   t = '1;36'; break;
    case 'white':    t = '37';   break;
    case 'b-white':  t = '1;37'; break;
    case 'normal':   t = '0';    break;
    case 'b-normal': t = '1;0';  break;
  }
  console.log('\033[' + t + 'm', target, '\033[0m');
}

function d(req, res)
{
  var now = new Date();
  c('--------------- REQUEST/ ' + now + ' ---------------', 'yellow');
  c('METHOD', 'green');
  c(req.method);
  c('URL', 'green');
  c(req.url);
  c('HEADERS', 'green');
  c(req.headers);
  c('PARAMS', 'green');
  c(req.params);
  c('BODY', 'green');
  c(req.body);
  c('--------------------------------------------------------------------------------', 'yellow');
}

/**
 * Capitalize the first letterf all words in a string
 */
function capitalize(str)
{
  //return str.charAt(0).toUpperCase() + str.slice(1);
  var pieces = str.split(' ');
  for (var i = 0; i < pieces.length; i++) {
    var j = pieces[i].charAt(0).toUpperCase();
    pieces[i] = j + pieces[i].substr(1);
  }
  return pieces.join(' ');
}

/**
 * Render
 */
function render(req, res, status, body)
{
  var contentType = 'text/plain';
  var statusCode = 200;

  switch (status) {
    case 'ok': statusCode = 200; break;
    case 'bad_request': statusCode = 400; break;
    case 'unauthorized': statusCode = 401; break;
    case 'forbidden': statusCode = 403; break;
    case 'not_found': statusCode = 404; break;
    case 'unprocessable_entity': statusCode = 422; break;
    case 'internal_server_error': statusCode = 500; break;
  }

  if (typeof body == 'undefined') {
    body = statusCode + ' ' + capitalize(status.replace('_', ' '));
    body = (req.params.format == 'html') ? body : { message: body };
  }

  switch (req.params.format) {
    case 'json':
      contentType = 'application/json';
      body = JSON.stringify(body);
      break;
    case 'html':
      contentType = 'text/html';
      if (typeof body == 'object') {
        body = JSON.stringify(body);
      }
      break;
  }

  res.writeHead(statusCode, {
    'Server': name,
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Date': new Date().getTime(),
    'Connection': 'close'
  });
  res.write(body);
  res.end();
  log(req, statusCode);
}

/**
 * Log
 */
function log(req, status)
{
  var params = [
    req.headers['x-forwarded-for'] || req.client.remoteAddress,
    new Date().toLocaleString(),
    req.method,
    req.url,
    status,
    req.headers.referer || '-',
    req.headers['user-agent'] || '-'
  ];
  util.log(params.join('\t'));
}
