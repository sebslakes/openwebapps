/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is trusted.js; substantial portions derived
 * from XAuth code originally produced by Meebo, Inc., and provided
 * under the Apache License, Version 2.0; see http://github.com/xauth/xauth
 *
 * Contributor(s):
 *   Michael Hanson <mhanson@mozilla.com>
 *   Dan Walkowski <dwalkowski@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/**
  2010-07-14
  First version of server code
  -Michael Hanson. Mozilla
**/

/*
* The server stores installed application metadata in local storage.
*
* The key for each application is the launch URL of the application;
* installation of a second app with the same launch URL will cause
* the first to be overwritten.
*
* The value of each entry is a serialized structure like this:
* {
*   app: { <application metadata> },
*   installTime: <install timestamp, UTC milliseconds>,
*   installURL: <the URL that invoked the install function>
* }
*
*/

;Repo = (function() {
    var appStorage = TypedStorage().open("app");
    var stateStorage = TypedStorage().open("state");

    // iterates over all stored applications manifests and passes them to a
    // callback function.  This function should be used instead of manual
    // iteration as it will parse manifests and purge any that are invalid.
    function iterateApps(callback) {
        // we'll automatically clean up malformed installation records as we go
        var toRemove = [];

        var appKeys = appStorage.keys();
        if (appKeys.length === 0) {
          return;
        }

        // manually iterating the apps (rather than using appStorage.iterate() allows
        // us to differentiate between a corrupt application (for purging), and
        // an error inside the caller provided callback function
        for (var i=0; i<appKeys.length; i++)
        {
            var aKey = appKeys[i];

            try {
                var install = appStorage.get(aKey);
                install.app = Manifest.validate(install.app);
                try {
                  callback(aKey, install);
                } catch (e) {
                  console.log("Error inside iterateApps callback: " + e);
                }
            } catch (e) {
                logError("invalid application detected: " + e);
                toRemove.push(aKey);
            }
        }

        for (var j = 0; j < toRemove.length; j++) {
            appStorage.remove(toRemove[i]);
        }
    };

    // Returns whether the given URL belongs to the specified domain (scheme://hostname[:nonStandardPort])
    function urlMatchesDomain(url, domain)
    {
        try {
            // special case for local testing
            if (url === "null" && domain === "null") return true;
            var parsedDomain = URLParse(domain).normalize();
            var parsedURL = URLParse(url).normalize();
            return parsedDomain.contains(parsedURL);
        } catch (e) {
            return false;
        }
    }

    // Returns whether this application runs in the specified domain (scheme://hostname[:nonStandardPort])
    function applicationMatchesDomain(application, domain)
    {
        var testURL = application.base_url;
        if (urlMatchesDomain(testURL, domain)) return true;
        return false;
    }

    // Return all installations that belong to the given origin domain
    function getInstallsForOrigin(origin)
    {
        var result = [];

        iterateApps(function(key, item) {
            if (applicationMatchesDomain(item.app, origin)) {
                result.push(item);
            }
        });

        return result;
    }

    // Return all installations that were installed by the given origin domain
    function getInstallsByOrigin(origin)
    {
        var result = [];

        iterateApps(function(key, item) {
            if (urlMatchesDomain(item.installURL, origin)) {
                result.push(item);
            }
        });

        return result;
    }

    // trigger application installation.
    //   origin -- the URL of the site requesting installation
    //   args -- the argument object provided by the calling site upon invocation of
    //           navigator.apps.install()
    //   promptDisplayFunc -- is a callback function that will be invoked to display a
    //           user prompt.  the function should accept 4 arguments which are:
    //             installOrigin --
    //             manifestToInstall --
    //             installationConfirmationFinishCallback --
    //             arguments object
    //   fetchManifestFunc -- a function that can can fetch a manifest from a remote url, accepts
    //             two args, a manifesturl and a callback function that will be invoked with the
    //             manifest JSON text or null in case of error.
    //   cb -- is a caller provided callback that will be invoked when the installation
    //         attempt is complete.

    function install(origin, args, promptDisplayFunc, fetchManifestFunc, cb) {

        function installConfirmationFinish(allowed)
        {
            if (allowed) {
                var key = manifestToInstall.base_url;
                if (manifestToInstall.launch_path) key += manifestToInstall.launch_path;

                // Create installation data structure
                var installation = {
                    app: manifestToInstall,
                    installTime: new Date().getTime(),
                    installURL: installOrigin
                };

                if (args.authorization_url) {
                    installation.authorizationURL = args.authorization_url;
                }

                // Save - blow away any existing value
                appStorage.put(key, installation);

                if (cb) cb(true);
            } else {
                if (cb) cb({error: ["denied", "User denied installation request"]});
            }
        }

        var manifestToInstall;
        var installOrigin = origin;

        if (args.manifest) {
            // this is a "direct install", which is currently only recommended
            // for developers.  We display a strongly-worded warning message
            // to scare users off.

            // Validate and clean the request
            try {
                manifestToInstall = Manifest.validate(args.manifest);
                promptDisplayFunc(installOrigin, manifestToInstall, installConfirmationFinish,
                                  { isExternalServer: true });

            } catch(e) {
                cb({error: ["invalidManifest", "couldn't validate your manifest: " + e]});
            }
        } else if (args.url) {
            // contact our server to retrieve the URL
            fetchManifestFunc(args.url, function(fetchedManifest) {
                if (!fetchedManifest) {
                    cb({error: ["networkError", "couldn't retrieve application manifest from network"]});
                } else {
                    try {
                        fetchedManifest = JSON.parse(fetchedManifest);
                    } catch(e) {
                        cb({error: ["manifestParseError", "couldn't parse manifest JSON from " + args.url]});
                        return;
                    }
                    try {
                        manifestToInstall = Manifest.validate(fetchedManifest);

                        // Security check: Does this manifest's calculated manifest URL match where
                        // we got it from?
                        var expectedURL = manifestToInstall.base_url + (manifestToInstall.manifest_name ? manifestToInstall.manifest_name : "manifest.webapp");
                        var isExternalServer = (expectedURL != args.url);

                        promptDisplayFunc(installOrigin, manifestToInstall, installConfirmationFinish,
                                          { isExternalServer: isExternalServer });

                    } catch(e) {
                        cb({error: ["invalidManifest", "couldn't validate your manifest: "]});
                    }
                }
            });
        } else {
            // neither a manifest nor a URL means we cannot proceed.
            cb({error: [ "missingManifest", "install requires a url or manifest argument" ]});
        }
    };

    function verify() {
        // XXX: write me
    }


    /** Determines which applications are installed for the origin domain */
    function getInstalled(origin) {
        var installsResult = getInstallsForOrigin(origin);

        // Caller doesn't get to see installs, just apps:
        var result = [];
        for (var i=0;i<installsResult.length;i++)
        {
            result.push(installsResult[i].app);
        }

        return result;
    };

    /** Determines which applications were installed by the origin domain. */
    function getInstalledBy(origin) {
        var installsResult = getInstallsByOrigin(origin);
        // Caller gets to see installURL, installTime, and manifest
        var result = [];
        for (var i=0;i<installsResult.length;i++)
        {
            result.push({
                installURL: installsResult[i].installURL,
                installTime: installsResult[i].installTime,
                manifest: installsResult[i].app,
            });
        }

        return result;
    };

    /* Management APIs for dashboards live beneath here */

    // A function which given an installation record, builds an object suitable
    // to return to a dashboard.  this function may filter information which is
    // not relevant, and also serves as a place where we can rewrite the internal
    // JSON representation into what the client expects (allowing us to change
    // the internal representation as neccesary)
    function generateExternalView(key, item) {
        // XXX: perhaps localization should happen here?  be sent as an argument
        // to the list function?
        var result = {
            id: key,
            installURL: item.installURL,
            installTime: item.installTime,
            launchURL: item.app.base_url + (item.app.launch_path ? item.app.launch_path : ""),
        };

        if (item.app && item.app.icons) result.icons = item.app.icons;
        if (item.app && item.app.name) result.name = item.app.name;
        if (item.app && item.app.description) result.description = item.app.description;
        if (item.app && item.app.developer) result.developer = item.app.developer;
        
        if (item.app && item.app.widget) {
          result.widgetURL = item.app.base_url + (item.app.widget.path ? item.app.widget.path : "");
          
          if (item.app.widget.width) {
            result.widgetWidth = parseInt(item.app.widget.width,10);
          }
              
          if (item.app.widget.height) {
            result.widgetHeight = parseInt(item.app.widget.height,10);
          }
        }

        return result;
    }

    function list() {
        var installed = [];
        iterateApps(function(key, item) {
            installed.push(generateExternalView(key, item));
        });
        return installed;
    };

    function remove(key) {
        var item = appStorage.get(key);
        if (!item) throw {error: [ "noSuchApplication", "no application exists with the id: " + key]};
        appStorage.remove(key);
        return true;
    };

    function loadState(id) {
        return stateStorage.get(id);
    };

    function saveState(id, state) {
        // storing null purges state
        if (state === undefined) {
            stateStorage.remove(id);
        } else  {
            stateStorage.put(id, state);
        }
        return true;
    };

    return {
        list: list,
        install: install,
        remove: remove,
        getInstalled: getInstalled,
        getInstalledBy: getInstalledBy,
        loadState: loadState,
        saveState: saveState,
        verify: verify
    }
})();