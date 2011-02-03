// a little node webserver designed to run the unit tests herein

var sys = require("sys"),
http = require("http"),
url = require("url"),
path = require("path"),
fs = require("fs");

// all bound webservers stored in this lil' object
var boundServers = { };
function getWebRootDir(host, port) {
  for (var k in boundServers) {
    var a = boundServers[k].address();
    if (host === a.address && port === a.port) {
      if (k === '_primary') return __dirname;
      else return path.join(__dirname, k);
    }
  }
  return undefined;
}

function fourOhFour(resp) {
  resp.writeHead(404, {"Content-Type": "text/plain"});
  resp.write("404 Not Found");
  resp.end();
  return undefined;
}

function createServer(port) {
  var myserver = http.createServer(function(request, response) {
    var hostname = request.headers['host'].toString("utf8");
    var port = parseInt(hostname.split(':')[1]);
    var host = hostname.split(':')[0];

    // normalize 'localhost', so it just works.
    if (host === 'localhost') host = '127.0.0.1';

    // get the directory associated with the port hit by client
    var siteroot = getWebRootDir(host, port);

    // unknown site?  really?
    if (siteroot === null) return fourOhFour(response);

    var filename = path.join(siteroot, url.parse(request.url).pathname);

    // hook to fetch manifests for HTML5 repos
    var parsedURI = url.parse(request.url, true);
    if (parsedURI.pathname == '/getmanifest') {
      var makeRequest = function (getURI) {
        getURI = url.parse(getURI);
        getURI.pathname = getURI.pathname || '/';
        getURI.search = getURI.search || '';
        getURI.port = getURI.port || '80';
        var client = http.createClient(parseInt(getURI.port), getURI.hostname);
        var siteRequest = client.request('GET',
                                         getURI.pathname + getURI.search,
                                         {host: getURI.host});
        siteRequest.end();
        siteRequest.on('response', function (siteResponse) {
          if (parsedURI.query.follow
              && siteResponse.statusCode > 300
              && siteResponse.statusCode < 400) {
            getURI = siteResponse.headers['location'];
            sys.puts('Proxy redirect to: ' + getURI);
            makeRequest(getURI);
            return;
          }
          response.writeHead(
            siteResponse.statusCode, siteResponse.headers);
          siteResponse.on('data', function (chunk) {
            response.write(chunk, 'binary');
          });
          siteResponse.on('end', function () {
            response.end();
          });
        });
      };
      makeRequest(parsedURI.query.url);
      sys.puts("Proxy URL " + parsedURI.query.url);
      return;
    }

    // servers.js is an artificial file which defines a data structure
    // where all of our servers are defined.  Ephemeral ports are used
    // to give us a better shot of just working as lots of test directories
    // are added, and this mechanism gives HTML based testing a means of
    // mapping test names (just dir names) into urls
    if (parsedURI.pathname == '/servers.js') {
      var serverToUrlMap = {};
      for (var k in boundServers) {
        var a = boundServers[k].address();
        serverToUrlMap[k] = "http://" + a.address + ":" + a.port;
      }
      var t = "var SERVERS = " + JSON.stringify(serverToUrlMap) + ";";
      response.writeHead(200, {"Content-Type": "application/x-javascript"});
      response.write(t);
      response.end();
      return;
    }

    var serveFile = function (filename) {
      console.log("serving " + filename);
      path.exists(filename, function(exists) {
        if(!exists) {
          response.writeHead(404, {"Content-Type": "text/plain"});
          response.write("404 Not Found");
          response.end();
          sys.puts("404 " + filename);
          return;
        }

        fs.readFile(filename, "binary", function(err, data) {
          if(err) {
            response.writeHead(500, {"Content-Type": "text/plain"});
            response.write(err + "n");
            response.end();
            sys.puts("500 " + filename);
            return;
          }

          // determine content type.  all text/ types will get hostnames replaced
          var exts = {
            ".js":   "text/javascript",
            ".css":  "text/css",
            ".html": "text/html"
          };
          var ext = path.extname(filename);
          var mimeType = (exts[ext]) ? exts[ext] : "application/unknown";

          response.writeHead(200, {"Content-Type": mimeType});
          response.write(data, "binary");
          response.end();
          sys.puts("200 " + filename);
        });
      });
    };

    // automatically serve index.html if this is a directory
    fs.stat(filename, function(err, s) {
      if (err === null && s.isDirectory()) {
        serveFile(path.join(filename, "index.html"));
      } else {
        serveFile(filename);
      }
    });
  });
  myserver.listen(0, "localhost");
  return myserver;
};

// start up webservers on ephemeral ports for each subdirectory here.
var dirs = fs.readdirSync(__dirname);

console.log("Starting test apps:");

// bind a primary testing webserver which will become the repostiory host
// and the place from which tests are run.
dirs.push("_primary");
dirs.forEach(function(d) {
  if (d !== '_primary' && !fs.lstatSync(path.join(__dirname,d)).isDirectory()) return;
  boundServers[d] = createServer(0);
  var addr = boundServers[d].address();
  console.log("  " + d + ": http://" + addr.address + ":" + addr.port);
});

var addr = boundServers["_primary"].address();
console.log("\nTesting server started, to run tests go to: http://" + addr.address + ":" + addr.port + "/tests.html");
