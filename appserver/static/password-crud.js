'use strict';

require(['jquery',
        'underscore',
        'splunkjs/mvc',
        'splunkjs/mvc/utils',
        'splunkjs/mvc/tokenutils',
        'splunkjs/mvc/messages',
        'splunkjs/mvc/searchmanager',
        'splunkjs/mvc/multidropdownview',
        'splunkjs/mvc/dropdownview',        
        '/static/app/rest-storage-passwords-manager/Modal.js',
        'splunkjs/mvc/simpleform/input/dropdown',
        'splunkjs/mvc/simplexml/ready!'],
function ($,
          _,
          mvc,
          utils,
          TokenUtils,
          Messages,
          SearchManager,
          MultiDropdownView,
          DropdownView,
          Modal,
          Dropdown) {

    

    function showPassword(row) {
        var dfd = $.Deferred();
        
        var splunkJsComponent = mvc.Components.getInstance("passwordSearch");

        if(splunkJsComponent) {
            splunkJsComponent.dispose();
        }

        var passwordSearch = new SearchManager({
            "id": "passwordSearch",
            "cancelOnUnload": true,
            "status_buckets": 0,
            "earliest_time": "-24h@h",
            "latest_time": "now",
            "sample_ratio": 1,
            "search": "| rest /servicesNS/-/-/storage/passwords splunk_server=local \
                | search title=" + row.realm + ":" + row.username + ": \
                | table clear_password",
            "app": utils.getCurrentApp(),
            "auto_cancel": 90,
            "preview": true,
            "tokenDependencies": {
            },
            "runWhenTimeIsUndefined": false
        }, {tokens: true, tokenNamespace: "submitted"});

        var mainSearch = mvc.Components.getInstance("passwordSearch");
        var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

        mainSearch.on('search:done', function(properties) {
            if(properties.content.resultCount == 0) {
                return renderModal("password-not-found",
                                    "Not Found",
                                    "<div class=\"alert alert-warning\"><i class=\"icon-alert\"></i>No password found. Verify <b>list_storage_passwords</b> capability role is enabled.</div>",
                                    "Close")
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            dfd.resolve(renderModal("show-password",
                                    "Password",
                                    "<h3>" + data[0].clear_password + "</h3>",
                                    "Close"));
        });

        return dfd.promise();
    } 

           

    function anonCallback(callback=function(){}, callbackArgs=null) {
        if(callbackArgs) {
            callback.apply(this, callbackArgs);
        } else { 
            callback();
        }
    }

    function genericPromise() {
        var dfd = $.Deferred();
        dfd.resolve();
        return dfd.promise();
    }

    // Wrapper to execute multiple searches in order and resolve when they've all finished
    function all(array){
        var deferred = $.Deferred();
        var fulfilled = 0, length = array.length;
        var results = [];
    
        if (length === 0) {
            deferred.resolve(results);
        } else {
            _.each(array, function(promise, i){
                $.when(promise()).then(function(value) {
                    results[i] = value;
                    fulfilled++;
                    if(fulfilled === length){
                        deferred.resolve(results);
                    }
                });
            });
        }
    
        return deferred.promise();
    };

    // Helper to figure out if the create form is open
    function isFormOpen() {
        var formOpen = window.sessionStorage.getItem("formOpen");
        if(_.isNull(formOpen) || _.isUndefined(formOpen) || formOpen === "false") {
            return false;
        } else {
            return true;
        }
    }

    // Callback to refresh window and hide create-user
    function refreshWindow() {
        setTimeout(function () {
            location.reload()
            $('#create-user').show();
        }, 500);
    }
    
    function renderModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {
        // Create the modal
        var myModal = new Modal(id, {
                    title: title,
                    backdrop: 'static',
                    keyboard: false,
                    destroyOnHide: true,
                    type: 'wide'
        }); 
    
        // Add content
        myModal.body.append($(body));
    
        // Add cancel button for update/delete action
        if(id == "user-delete-confirm" || id == "update-user-form") {
            myModal.footer.append($('<cancel>').attr({
                type: 'button',
                'data-dismiss': 'modal'
            })
            .addClass('btn btn-secondary').text("Cancel")).on('click', function(){});
        }

        // Add footer
        myModal.footer.append($('<button>').attr({
            type: 'button',
            'data-dismiss': 'modal'
        })
        .addClass('btn btn-primary').text(buttonText).on('click', function () {
                anonCallback(callback, callbackArgs); 
        }))

        // Launch it!  
        myModal.show(); 
    }

    // Clear click listener and register with new callback
    function clearOnClickAndRegister(el, callback, callbackArgs=null) {
        // Register click callback
        if(_.isUndefined($._data($(el).get(0), "events"))) {
            $(el).on('click', function (event) {
                event.preventDefault();
                anonCallback(callback, callbackArgs);
            });
            return;    
        }

        // Unregister click callback
        if(_.isObject($._data($(el).get(0), "events")) && _.has($._data($(el).get(0), "events"), "click")) {
            $(el).off('click');
            $(el).on('click', function () {
                anonCallback(callback, callbackArgs);
            });
        }
    }

    // Return selected rows from bootstrap-table
    function getIdSelections() {
        return $.map($('#rest-password-table').bootstrapTable('getSelections'), function (row) {
            return row
        });
    }
    

    // Run search to populate and call create table
    function populateTable() {
        // Initialize
        window.sessionStorage.setItem("formOpen", "false");
        var contextMenuDiv = '#context-menu';
        var passwordTableDiv = '#password-table';

        var search1 = new SearchManager({
                    "id": "search1",
                    "cancelOnUnload": true,
                    "status_buckets": 0,
                    "earliest_time": "-24h@h",
                    "latest_time": "now",
                    "sample_ratio": 1,
                    "search": "| rest /servicesNS/-/-/configs/conf-passwords splunk_server=local \
                        | rex field=title \"credential:(?<realm>.*?):(?<username>.*?):\" \
                        | eval uri_base=\"/en-US/splunkd/__raw\" | rex field=id \"(?<rest_uri>/servicesNS.*?$)\" | eval rest_uri = uri_base + rest_uri \
                        | fields username, eai:userName, password, realm, eai:acl.app, eai:acl.owner, eai:acl.perms.read, eai:acl.perms.write, eai:acl.sharing, realm, rest_uri \
                        | rename eai:userName as user, eai:acl.app as app, eai:acl.owner as owner, eai:acl.perms.read as acl_read, eai:acl.perms.write as acl_write, eai:acl.sharing as acl_sharing \
                        | table username, password, realm, app, owner, acl_read, acl_write, acl_sharing, rest_uri \
                        | fillnull value=\"\"",
                    "app": utils.getCurrentApp(),
                    "auto_cancel": 90,
                    "preview": true,
                    "tokenDependencies": {
                    },
                    "runWhenTimeIsUndefined": false
                }, {tokens: true, tokenNamespace: "submitted"});

        var mainSearch = splunkjs.mvc.Components.getInstance("search1");
        var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

        mainSearch.on('search:progress', function(properties) {
            Messages.render("waiting", $(passwordTableDiv));
        });

        mainSearch.on('search:done', function(properties) {
            document.getElementById("password-table").innerHTML = "";

            if(properties.content.resultCount == 0) {
                var noData = null;
                createTable(passwordTableDiv, contextMenuDiv, noData);
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            createTable(passwordTableDiv, contextMenuDiv, data);
        });
    }

    // Render credential table and wire up context menu
    function createTable(tableDiv, contextMenuDiv, data) {
        var html = '<div id="open-close-button"> \
                      <p><button id="main-create" class="btn btn-primary" data-toggle="collapse" href="#create-update-form">Create</button></p> \
                    </div> \
                    <div id="create-update-form" class="collapse multi-collapse"> \
                      <div id="createCredential"> \
                       <form id="createCredential"> \
                        <div class="form-group"> \
                            <label for="username">Username</label> \
                            <input type="username" class="form-control" id="createUsername" placeholder="Enter username"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="password">Password</label> \
                            <input type="password" class="form-control" id="createPassword" placeholder="Password"> \
                        </div> \
                        <div> \
                            <label for="confirmPassword">Confirm Password</label> \
                            <input type="password" class="form-control" id="createConfirmPassword" placeholder="Confirm Password"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="realm">Realm</label> \
                            <input type="realm" class="form-control" id="createRealm" placeholder="Realm"> \
                            <br></br>\
                        </div> \
                        <div class="form-group"> \
                            <label for="owner" id="owner">Owner</label> \
                            <div id="owner-dropdown"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="readUsers" id="read-users">Read Users</label> \
                            <div id="read-user-multi"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="writeUsers" id="write-users">Write Users</label> \
                            <div id="write-user-multi"></div> \
                        </div> \
                        <div class="form-group" id="app-scope"> \
                            <label for="appScope">App Scope</label> \
                            <div id="app-scope-dropdown"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="sharing" id="sharing">Sharing</label> \
                            <div id="sharing-dropdown"></div> \
                         </div> \
                        <div id="create-credential-submit"> \
                          <button id="create-submit" class="btn btn-primary">Create</button> \
                        </div> \
                        </form> \
                      </div> \
                    </div>';                      

        var tdHtml = "";
        var contextMenu = '<ul id="example1-context-menu" class="dropdown-menu"> \
                             <li data-item="update"><a>Update</a></li> \
                             <li data-item="delete"><a>Delete</a></li> \
                           </ul>';
        var header = '  <div> \
                            <div id="toolbar"> \
                            <button id="remove" type="button" class="btn icon-x btn-danger" disabled> Delete</button> \
                            </div> \
                        <table id="rest-password-table" \
                             class="table table-striped table-hover" \
                             data-toolbar="#toolbar" \
                             data-detail-view="true" \
                             data-sort-name="username" \
                             data-show-pagination-switch="true" \
                             data-id-field="id" \
                             data-pagination="true" \
                             data-sortable="true" \
                             data-page-size="10" \
                             data-page-list="[10,20,50,ALL]" \
                             data-id-field="id" \
                             data-toggle="table" \
                             data-smart-display="true" \
                             data-search="true" \
                             data-checkbox-header="true" \
                             data-show-footer="false" \
                             data-select-item-name="button-select" \
                             data-click-to-select="false"> \
                      <thead> \
                        <tr> \
                            <th data-field="state" data-checkbox="true"></th> \
                            <th data-field="id" data-visible="false" data-align="center"><div><h3>ID</h3></th> \
                            <th data-field="username" data-sortable="true" data-align="center"><div><h3>Username</h3></th> \
                            <th data-field="password" data-events="operateEvents" data-align="center"><div><h3>Password</h3></div></th> \
                            <th data-field="realm" data-sortable="true" data-align="center"><div><h3><h3>Realm</h3></div></th> \
                            <th data-field="app" data-sortable="true" data-align="center"><div><h3>App</h3></div></th> \
                            <th data-field="clear_password" data-visible="false" data-align="center"><div><h3>Clear Password</h3></div></th> \
                            <th data-field="owner" data-sortable="true" data-align="center"><div><h3>Owner</h3></div></th> \
                            <th data-field="acl_read" data-sortable="true" data-align="center"><div><h3>Read</h3></div></th> \
                            <th data-field="acl_write" data-sortable="true" data-align="center"><div><h3>Write</h3></div></th> \
                            <th data-field="acl_sharing" data-sortable="true" data-align="center"><div><h3>Sharing</h3></div></th> \
                            <th data-field="rest_uri" data-visible="false" data-align="center"><div><h3>REST URI</h3></div></th> \
                        </tr> \
                      </thead> \
                      <tbody>';
        html += header;

        _.each(data, function(row, i) {
            tdHtml += '<tr class="striped">\
                         <td class="bs-checkbox"></td>\
                         <td>' + i + '</td>\
                         <td>' + row.username + '</td>\
                         <td>\
                           <a class="show" href="javascript:void(0)" title="Show Password">\
                             <li class="icon-visible"></li>\
                           </a>\
                         </td>\
                         <td>' + row.realm + '</td>\
                         <td>' + row.app + '</td>\
                         <td>' + row.clear_password + '</td>\
                         <td>' + row.owner + '</td>\
                         <td>' + row.acl_read + '</td>\
                         <td>' + row.acl_write + '</td>\
                         <td>' + row.acl_sharing + '</td>\
                         <td>' + row.rest_uri + '</td>\
                       </tr>';
        });
        
        tdHtml += "</tbody></table></div>";
        html += tdHtml;
        
        // Render table
        $(tableDiv).append(html);

        // Rendeer context menu div
        $(contextMenuDiv).append(contextMenu);

        // Register click listener on create button
        $('#main-create').on('click', function () { 
            if(!isFormOpen()) {
                // Change text to close
                $('#main-create').text("Close");
                window.sessionStorage.setItem("formOpen", "true");

                // Clear form values
                $('input[id=createUsername]').val("");
                $('input[id=createRealm]').val("");        
            } else {
                $('#main-create').text("Create");
                window.sessionStorage.setItem("formOpen", "false");
            }
            
            // Rnder the create user form
            anonCallback(renderCreateUserForm, ["",""])
        });

        // Current row index in table
        var curIndex = null;

        // Create bootstrap-table
        $('#rest-password-table').bootstrapTable({
            contextMenu: '#example1-context-menu',
            onContextMenuItem: function(row, $el){
                // Actions for right click on row
                if($el.data("item") == "update"){
                    $('#rest-password-table').bootstrapTable('expandRow', curIndex);                    
                } else if($el.data("item") == "delete"){
                    deleteMultiCredential([row]);        
                }                
            },
            onContextMenuRow: function(row, $el){ 
                // Set the current index when context menu triggered
                curIndex = $el.data().index;
            },
            onExpandRow: function(index, row, $detail) {
                // Add a new table row below current element
                $detail.html('<table></table>').find('table').append('<tr><td><div id="' + row.username + '"></div></td></tr>');
                
                // Logic to collapse previous row when new row expanded
                $('#rest-password-table').find('.detail-view').each(function () {
                    if (!$(this).is($detail.parent())) {
                      $(this).prev().find('.detail-icon').click()
                  }
                })

                // Render the update form
                renderUpdateUserInTable(row);
            }

        });
        
        // Toggle remove button on or off depending whether rows are checked
        $('#rest-password-table').on('check.bs.table uncheck.bs.table ' +
                'check-all.bs.table uncheck-all.bs.table', function () {
            $('#remove').prop('disabled', !$('#rest-password-table').bootstrapTable('getSelections').length);
        });

        // Wire remove button to delete credentials
        $('#remove').click(function () {
            var rows = getIdSelections();
            deleteMultiCredential(rows);
            $('#remove').prop('disabled', true);
        });
    }

    // Delete credentials
    function deleteMultiCredential(rows) {

        // Delete a single credential
        var deleteCred = function (row) {
            var dfd = $.Deferred();
            var deleteUrl = "/en-US/splunkd/__raw/servicesNS/" + row.owner + "/" + row.app + "/storage/passwords/" + row.realm + ":" + row.username +":";
            var message = [];
            var payload = {"body": undefined,
                           "responseCode": undefined}
            var aclUrl = row.rest_uri + "/acl";
            var aclData = {"perms.read": row.acl_read,
                           "perms.write": row.acl_write,
                           "sharing": row.acl_sharing == "user" ? "app":row.acl_sharing,
                           "owner": row.owner}

            $.ajax({
                type: "POST",
                url: aclUrl,
                data: aclData,
                error: function(xhr, textStatus, error) {
                    payload.body = "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to delete user <b> " + row.username + "</b> - " + xhr.responseText + "</div>";
                    payload.responseCode = xhr.status;
                    message.push(payload);
                    dfd.resolve(message);
                }
            })
            .then(function() {
                $.ajax({
                    type: "DELETE",
                    url: deleteUrl,
                    success: function(data, textStatus, xhr) {
                        payload.body = "<div><i class=\"icon-check-circle\"></i> Successfully deleted credential - <b>" + row.realm + ":" + row.username + "</b></div>";
                        payload.responseCode = xhr.status;
                        message.push(payload);
                        dfd.resolve(message);
                    },
                    error: function(xhr, textStatus, error) {
                        payload.body = "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to delete user <b> " + row.username + "</b> - " + xhr.responseText + "</div>";
                        payload.responseCode = xhr.status;
                        message.push(payload);
                        dfd.resolve(message);
                    }
                })
            })

            return dfd.promise();                                
        }

        var removeUsers = function () {
            // promise array
            var promises = [];
            
            _.each(rows, function(row, i) {
                // Push each row to be deleted onto promises array
                promises.push(function() {
                    return deleteCred(row);
                });    
            });

            // Execute deletes and display message
            $.when(all(promises)).then(function(messages) {
                var status = "";
                var failCount = 0;
                var deleteCount = messages.length;
                var prefix = "Credential";
                var modalMessage = $.map(messages, function(i) {
                    var payload = i[0];
                    if(parseInt(payload.responseCode) != 200) {
                        failCount += 1;
                    }
                    return payload.body;
                })

                if(failCount == deleteCount) {
                    status = prefix + " Delete Failed";
                } else if (failCount > 0 && failCount < deleteCount) {
                    status = prefix + " Delete Partially Succeeded"
                } else {
                    status = prefix + " Deleted";
                }

                renderModal("user-delete",
                             status,
                             modalMessage.join("\n"),
                             "Close",
                             refreshWindow)                 
            });
        }

        // Get the usernames from all rows
        var users = $.map(rows, function(row) {
            return row.username;
        })

        // Render delete confirmation modal and regester delete callback action
        var deleteUser = renderModal("user-delete-confirm",
                                     "Confirm Delete Action",
                                     "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>You're about to remove the users <b>" + users.join(', ') + "</b> - Press ok to continue</div>",
                                     "Ok",
                                     removeUsers,
                                     [rows]);
    }

     /**
         * SplunkJS Input object and methods
         * @param {object}      config      Config object holding component specific definitions
         */
    function splunkJSInput(config) {
        var config = this.config = config;

        // Form to render for updating user
        var htmlForm = '<div id="' + this.config.username + '" class="collapse multi-collapse"> \
                      <div id="createCredential"> \
                       <form id="createCredential"> \
                        <div class="form-group"> \
                            <label for="username">Username</label> \
                            <input type="username" class="form-control" id="createUsername" placeholder="Enter username"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="password">Password</label> \
                            <input type="password" class="form-control" id="createPassword" placeholder="Password"> \
                        </div> \
                        <div> \
                            <label for="confirmPassword">Confirm Password</label> \
                            <input type="password" class="form-control" id="createConfirmPassword" placeholder="Confirm Password"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="realm">Realm</label> \
                            <input type="realm" class="form-control" id="createRealm" placeholder="Realm"> \
                            <br></br>\
                        </div> \
                        <div class="form-group"> \
                            <label for="owner" id="owner">Owner</label> \
                            <div id="owner-dropdown"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="readUsers" id="read-users">Read Users</label> \
                            <div id="read-user-multi"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="writeUsers" id="write-users">Write Users</label> \
                            <div id="write-user-multi"></div> \
                        </div> \
                        <div class="form-group" id="app-scope"> \
                            <label for="appScope">App Scope</label> \
                            <div id="app-scope-dropdown"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="sharing" id="sharing">Sharing</label> \
                            <div id="sharing-dropdown"></div> \
                         </div> \
                        <div id="create-credential-submit"> \
                          <button id="create-submit" class="btn btn-primary">Submit</button> \
                        </div> \
                        </form> \
                      </div> \
                    </div>'

        // Save context 
        var that = this;

        // Remove component and add div back
        this.remove = function() {
            var el = "#" + this.config.parentEl;
            var splunkJsComponent = mvc.Components.get(this.config.id);

            if(splunkJsComponent) {
                splunkJsComponent.remove();
                $(el).append('<div id="' + this.config.el + '"></div>');    
            }
        }

        // Remove component from inline update form. Don't add the div back since it's dynamic
        this.updateRemove = function() {
            var el = "#" + this.config.parentEl;
            var splunkJsComponent = mvc.Components.get(this.config.id);
            
            if(splunkJsComponent) {
                splunkJsComponent.remove();
            }
        }

        // Render the component in the form
        this.renderComponent = function () {
            // Remove component if it exists
            that.remove();

            var el = "#" + this.config.el;

            // Get search manager
            var splunkJsComponentSearch = mvc.Components.get(this.config.id + "-search");

            // Check to make sure div is there before rendering
            if ($(el).length) {
                var choices = _.has(this.config, "choices") ? this.config.choices:[];    
    
                // Create search manager if it doesn't exist
                if(!splunkJsComponentSearch) {
                    this.config.searchInstance = new SearchManager({
                        id: this.config.id + "-search",
                        search: this.config.searchString 
                    });
                }

                if(this.config.type == "dropdown") {
                    this.config.instance = new DropdownView({
                        id: this.config.id,
                        managerid: _.isUndefined(this.config.searchString) ? null:this.config.id + "-search",
                        choices: choices,
                        labelField: "label",
                        valueField: "value",
                        default: _.has(this.config, "default") ? this.config.default:null,
                        el: $(el)
                    }).render();                       
                } else {
                    this.config.instance = new MultiDropdownView({
                        id: this.config.id,
                        choices: choices,
                        managerid: _.isUndefined(this.config.searchString) ? null:this.config.id + "-search",
                        labelField: "label",
                        valueField: "value",
                        width: 350,
                        default: _.has(this.config, "default") ? this.config.default:null,
                        el: $(el)
                    }).render();         
                }
            } else {
                setTimeout(function() {
                    that.renderComponent();
                }, 100);
            }
        }
        
        // Get values from bootstrap table
        this.getVals = function() {
            return this.config.instance.val();
        }
    }

    // Used to render create form
    function renderCreateUserForm(cUsername = false, cRealm = false) {
        var createUser = function createUser() {
            var aclData = {};
            var formVals = {};

            _.each(arguments[2], function(component, i) {
                var aclKey = component.config.aclKey;
                aclData[aclKey] = _.isArray(component.getVals()) ? component.getVals().join():component.getVals();
                formVals[aclKey] = _.isArray(component.config.default) ? component.config.default.join():component.config.default;
            });

            var username = $('input[id=createUsername]').val();
            var password = $('input[id=createPassword]').val();
            var confirmPassword = $('input[id=createConfirmPassword]').val();
            var realm = $('input[id=createRealm]').val();
            
            if(username == "") {
                return renderModal("missing-username",
                                    "Missing Username",
                                    "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Please enter a username</div>",
                                    "Close")
            }

            if(password == "") {
                return renderModal("missing-password",
                                    "Missing Password",
                                    "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Please enter a password</div>",
                                    "Close")
            }

            if(username && !password) {
                return renderModal("missing-password",
                                    "Missing Password",
                                    "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Please enter a password</div>",
                                    "Close");
            }

            // Create object to POST for user creation
            var createData = {"name": username,
                              "password": password,
                              "realm": realm};


            if(password != confirmPassword) {
                return renderModal("password-mismatch",
                                    "Password Mismatch",
                                    "<div class=\"alert alert-warning\"><i class=\"icon-alert\"></i>Passwords do not match</div>",
                                    "Close");
            } else {
                var currentUser = Splunk.util.getConfigValue("USERNAME");
                var createUrl = "/en-US/splunkd/__raw/servicesNS/" + currentUser + "/" + aclData.app + "/storage/passwords";
                var aclUrl = "/en-US/splunkd/__raw/servicesNS/" + currentUser + "/" + aclData.app + "/configs/conf-passwords/credential%3A" + realm + "%3A" + username + "%3A/acl";

                // Success message for final modal display
                var message = [];

                $.ajax({
                    type: "POST",
                    url: createUrl,
                    data: createData,
                    success: function(data, textStatus, xhr) {
                        message.push("<div><i class=\"icon-check-circle\"></i> Successfully created user <b>" + realm + ":" + username + "</b></div>");
                    },
                    error: function(xhr, textStatus, error) {
                        message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to create user <b>" + username + ":" + realm + "</b> - " + xhr.responseText + "</div>");
                    }
                })
                .then(function() {
                    // App not a valid key for updating Splunk ACL's, remove it before posting
                    delete aclData.app;

                    // Need to set sharing to app level before applying ACL's otherwise read/write perms don't apply
                    // ACL's will get re-applied back to user sharing context in next chain ACL apply
                    if(aclData.sharing == "user") {
                        var aclDataCopy = _.clone(aclData);
                        aclDataCopy.sharing = "app";
                        
                        return $.ajax({
                            type: "POST",
                            url: aclUrl,
                            data: aclDataCopy,
                            error: function(xhr, textStatus, error) {
                                message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to apply ACL - " + xhr.responseText + "</div>");
                            }
                        })
                    }
                })
                .then(function () {
                    return $.ajax({
                        type: "POST",
                        url: aclUrl,
                        data: aclData,
                        success: function(data, textStatus, xhr) {
                            message.push("<div><i class=\"icon-check-circle\"></i> Successfully applied ACL's</div>")
                        },
                        error: function(xhr, textStatus, error) {
                            message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to apply ACL - " + xhr.responseText + "</div>");
                        }
                    })
                })
                .done(function () {
                    renderModal("user-create",
                                "User Created",
                                message.join('\n'),
                                "Close",
                                refreshWindow)
                })
                .fail(function() {
                    renderModal("user-create-fail",
                                "User Create Failed",
                                message.join('\n'),
                                "Close",
                                refreshWindow)
                });
            }
        }

        var inputs = [new splunkJSInput({"id": "app-scope-dropdown",
                       "searchString": "| rest /servicesNS/-/-/apps/local splunk_server=local | search disabled=0 | rename title as value | table label, value",
                       "el": "app-scope-dropdown",
                       "type": "dropdown",
                       "default": utils.getCurrentApp(),
                       "aclKey": "app",
                       "parentEl": "app-scope"}),
                       new splunkJSInput({"id": "read-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles splunk_server=local | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "read-user-multi",
                        "type": "multi-dropdown",
                        "default": "*",
                        "choices": [{"label":"*", "value":"*"}],
                        "aclKey": "perms.read",
                        "parentEl": "read-users"}),
                       new splunkJSInput({"id": "write-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles splunk_server=local | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "write-user-multi",
                        "type": "multi-dropdown",
                        "parentEl": "write-users",
                        "aclKey": "perms.write",
                        "choices": [{"label":"*", "value":"*"}],
                        "default": ["admin","power"]}),
                       new splunkJSInput({"id": "sharing-dropdown",
                        "choices": [{"label":"global", "value": "global"},
                                    {"label":"app", "value": "app"},
                                    {"label":"user", "value": "user"}],
                        "el": "sharing-dropdown",
                        "type": "dropdown",
                        "parentEl": "sharing",
                        "aclKey": "sharing",
                        "default": "app"}),
                       new splunkJSInput({"id": "owner-dropdown",
                        "searchString": "| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | table label, value",
                        "el": "owner-dropdown",
                        "type": "dropdown",
                        "aclKey": "owner",
                        "default": Splunk.util.getConfigValue("USERNAME"),
                        "parentEl": "owner"})];

        // Render components
        _.each(inputs, function(input, i) {
            input.renderComponent();
        });

        // Register createUser callback for button
        clearOnClickAndRegister('#create-submit', createUser, [cUsername, cRealm, inputs]);
    
        setTimeout(function () {
            if(cUsername != "" || cRealm != "") {
                $('input[id=createUsername]').val(cUsername);
                $('input[id=createRealm]').val(cRealm);
            }
        }, 300);
    }

    // Render form under row in bootstrap-table
    function renderUpdateUserInTable(row) {
        var updateUser = function updateUser () {
            var formVals = {};
            var aclData = {};

            // Process SplunkJS form components
            _.each(arguments[0], function(component, i) {
                var aclKey = component.config.aclKey;
                // Save submitted values
                aclData[aclKey] = _.isArray(component.getVals()) ? component.getVals().join():component.getVals();

                // Save initial form values
                formVals[aclKey] = _.isArray(component.config.default) ? component.config.default.join():component.config.default;
            });
            
            // Grab input values
            var username = $('input[id=updateUsername]').val();
            var password = $('input[id=updatePassword]').val();
            var confirmPassword = $('input[id=updateConfirmPassword]').val();
            var realm = $('input[id=updateRealm]').val();

            // Save app info since we delete when posting
            var aclApp = aclData.app;
            var app = formVals.app;

            // App is not a valid field when posting to /acl. Remove from object.
            delete aclData.app;

            // Initialze to apply ACL's
            var applyAcl = true;

            // Make sure both password fields are set
            if(!password && confirmPassword) {
                return renderModal("password-mismatch",
                                   "Password Error",
                                   "<div class=\"alert alert-warning\"><i class=\"icon-alert\"></i>Please set password and confirm password fields</div>",
                                   "Close");
            }

            // No change when form data and submitted values are the same and password is blank
            if(JSON.stringify(formVals) === JSON.stringify(aclData) && !password) {
                return renderModal("no-change",
                                   "No Change Detected",
                                   "<div class=\"alert alert-info\"><i class=\"icon-alert\"></i>Nothing to see here</div>",
                                   "Close")
            }

            // // If ACL's haven't changed, don't apply
            // if(JSON.stringify(formVals) === JSON.stringify(aclData)) {
            //     applyAcl = false;
            // }

            // Add realm to formVals for refrence in REST url's
            formVals.realm = arguments[1].realm;
            
            if(password != confirmPassword) {
                renderModal("password-mismatch",
                            "Password Mismatch",
                            "<div class=\"alert alert-warning\"><i class=\"icon-alert\"></i>Passwords do not match</div>",
                            "Close");
            } else {
                var aclUrl = row.rest_uri + "/acl";

                // Success message for final modal display
                var message = [];

                // Copy acl data to new object
                var aclDataCopy = _.clone(aclData);

                // Set sharing to app for consistent behavior through app and password changes
                // When sharing is set to app, eai:userName is always 'nobody' and this gives a predictable
                // URI to change password and move configs between apps.
                // We'll set sharing back to the form value after password change and movement between apps.
                aclDataCopy.sharing = "app";
                
                // Apply ACL's
                $.ajax({
                    type: "POST",
                    url: aclUrl,
                    data: aclDataCopy,
                    error: function(xhr, textStatus, error) {
                        message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to update password for user <b>" + username + "</b> - " + xhr.responseText + "</div>");
                    }
                })
                .then (function() {
                    // Change the password
                    if(password) {
                        var passwordUrl = "/en-US/splunkd/__raw/servicesNS/nobody/" + formVals.app + "/storage/passwords/" + formVals.realm + ":" + username + ":";

                        return $.ajax({
                            type: "POST",
                            url: passwordUrl,
                            data: {"password": password},
                            success: function(data, textStatus, xhr) {
                                message.push("<div><i class=\"icon-check-circle\"></i> Successfully updated password for credential - <b>" + formVals.realm + ":" + username + "</b></div>");
                            },
                            error: function(xhr, textStatus, error) {
                                message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to update password for user <b>" + username + "</b> - " + xhr.responseText + "</div>");
                            }
                        })
                    }
                })                
                .then(function() {
                    // Move app context
                    if(formVals.app != aclApp) {
                        var moveUrl = "/en-US/splunkd/__raw/servicesNS/nobody/" + formVals.app + "/configs/conf-passwords/credential%3A" + formVals.realm + "%3A" + username + "%3A/move"; 
                                        
                        return $.ajax({
                            type: "POST",
                            url: moveUrl,
                            data: {"app": aclApp, "user": "nobody"},
                            success: function(data, textStatus, xhr) {
                                message.push("<div><i class=\"icon-check-circle\"></i> Successfully moved credential from <b>" + formVals.app + "</b> to <b>" + aclApp + "</b></div>");
                            },
                            error: function(xhr, textStatus, error) {
                                message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to move credential from <b>" + formVals.app + "</b> to <b>" + aclApp + "</b> - " + xhr.responseText + "</div>");
                            }
                        })
                    }
                })
                .then(function() {
                    // Apply ACL's back to submitted values
                    aclUrl = "/en-US/splunkd/__raw/servicesNS/nobody/" + aclApp + "/configs/conf-passwords/credential%3A" + formVals.realm + "%3A" + username + "%3A/acl";

                    return $.ajax({
                        type: "POST",
                        //url: newAclUrl,
                        url: aclUrl,
                        data: aclData,
                        success: function(data, textStatus, xhr) {
                            message.push("<div><i class=\"icon-check-circle\"></i> Successfully applied ACL's</div>")
                        },
                        error: function(xhr, textStatus, error) {
                            message.push("<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to apply ACL - " + xhr.responseText + "</div>");
                        }
                    })
                })
                .done(function() {
                    renderModal("user-updated",
                                "User Updated",
                                message.join('\n'),
                                "Close",
                                refreshWindow)                        
                })
                .fail(function() {
                    renderModal("user-update-failed",
                                "User Update Failed",
                                message.join('\n'),
                                "Close",
                                refreshWindow)
                });
            }
        }

        //var divId = "#" + row.username;
        var divId = "div[id='" + row.username + "']";

        var htmlForm = '<form id="' + row.username + '-update-form"> \
                        <div class="form-group"> \
                            <label for="username">Username</label> \
                            <input type="username" class="form-control" id="updateUsername" placeholder="Enter username"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="password">Password</label> \
                            <input type="password" class="form-control" id="updatePassword" placeholder="Password"> \
                        </div> \
                        <div> \
                            <label for="confirmPassword">Confirm Password</label> \
                            <input type="password" class="form-control" id="updateConfirmPassword" placeholder="Confirm Password"> \
                        </div> \
                        <div class="form-group"> \
                            <label for="realm">Realm</label> \
                            <input type="realm" class="form-control" id="updateRealm" placeholder="Realm" disabled> \
                            <br></br>\
                        </div> \
                        <div class="form-group"> \
                            <label for="owner" id="owner-inline">Owner</label> \
                            <div id="owner-dropdown-inline"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="readUsers" id="read-users-inline">Read Users</label> \
                            <div id="read-user-multi-inline"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="writeUsers" id="write-users-inline">Write Users</label> \
                            <div id="write-user-multi-inline"></div> \
                        </div> \
                        <div class="form-group" id="app-scope-inline"> \
                            <label for="appScope">App Scope</label> \
                            <div id="app-scope-dropdown-inline"></div> \
                        </div> \
                        <div class="form-group"> \
                            <label for="sharing" id="sharing-inline">Sharing</label> \
                            <div id="sharing-dropdown-inline"></div> \
                         </div> \
                        <div id="update-credential-inline-submit"> \
                          <button id="update-submit-inline" class="btn btn-primary">Update</button> \
                        </div> \
                        </form>'

        $(divId).append(htmlForm);
        
        // Set form username and realm
        $('input[id=updateUsername]').val(row.username);
        $('input[id=updateRealm]').val(row.realm);

        var inputs = [new splunkJSInput({"id": "app-scope-dropdown-inline",
                       "searchString": "| rest /servicesNS/-/-/apps/local splunk_server=local | search disabled=0 | rename title as value | table label, value",
                       "el": "app-scope-dropdown-inline",
                       "type": "dropdown",
                       "default": [row.app],
                       "aclKey": "app",
                       "parentEl": "app-scope-inline"}),
                       new splunkJSInput({"id": "read-user-multi-inline",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles splunk_server=local | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "read-user-multi-inline",
                        "type": "multi-dropdown",
                        "default": row.acl_read.split(','),
                        "aclKey": "perms.read",
                        "choices": [{"label":"*", "value":"*"}],
                        "parentEl": "read-users-inline"}),
                       new splunkJSInput({"id": "write-user-multi-inline",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles splunk_server=local | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "write-user-multi-inline",
                        "type": "multi-dropdown",
                        "parentEl": "write-users-inline",
                        "aclKey": "perms.write",
                        "choices": [{"label":"*", "value":"*"}],
                        "default": row.acl_write.split(',')}),
                       new splunkJSInput({"id": "sharing-dropdown-inline",
                        "choices": [{"label":"global", "value": "global"},
                                    {"label":"app", "value": "app"},
                                    {"label":"user", "value": "user"}],
                        "el": "sharing-dropdown-inline",
                        "type": "dropdown",
                        "parentEl": "sharing-inline",
                        "aclKey": "sharing",
                        "default": [row.acl_sharing]}),
                       new splunkJSInput({"id": "owner-dropdown-inline",
                        "searchString": "| rest /servicesNS/-/-/authentication/users splunk_server=local | eval label=title | rename title as value | table label, value",
                        "el": "owner-dropdown-inline",
                        "type": "dropdown",
                        "default": [row.owner],
                        "aclKey": "owner",
                        "parentEl": "owner-inline"})];

        // Render component
        _.each(inputs, function(input, i) {
            input.renderComponent();
        });

        // Register updateUser callback for button
        clearOnClickAndRegister('#update-submit-inline', updateUser, [inputs, row]);
    }

    // listener used to show password when clicking the eye icon in the table
    window.operateEvents = {
        'click .show': function (e, value, row, index) {
            var aclData = {"perms.read": row.acl_read,
                            "perms.write": row.acl_write,
                            "sharing": row.acl_sharing,
                            "owner": row.owner}

            // Change sharing to app, show password, change back to user
            if(row.acl_sharing == "user") {
                //var aclUrl = "/en-US/splunkd/__raw/servicesNS/" + row.owner + "/" + row.app + "/configs/conf-passwords/credential%3A" + row.realm + "%3A" + row.username + "%3A/acl";
                var aclUrl = row.rest_uri + "/acl";
                var aclDataCopy = _.clone(aclData);
                aclDataCopy.sharing = "app";

                $.ajax({
                    type: "POST",
                    url: aclUrl,
                    data: aclDataCopy,
                    error: function(xhr, textStatus, error) {
                        return renderModal("fail-password-view",
                                           "Cannot View Password",
                                           "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to view password - " + xhr.responseText + "</div>",
                                           "Close");
                    }
                })
                .then(function() {
                    return showPassword(row);
                })
                .done(function() {
                    $.ajax({
                        type: "POST",
                        url: aclUrl,
                        data: aclData,
                        error: function(xhr, textStatus, error) {
                            return renderModal("fail-password-view",
                                               "Cannot View Password",
                                               "<div class=\"alert alert-error\"><i class=\"icon-alert\"></i>Failed to view password - " + xhr.responseText + "</div>",
                                               "Close");
                        }
                    })
                })
            } else {
                showPassword(row);
            }
        }
    }; 

    // Kick it all off
    populateTable();

});
