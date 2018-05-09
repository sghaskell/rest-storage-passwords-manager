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
        '/static/app/password-manager/Modal.js',
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
        renderModal("show-password",
                    "Clear Password",
                    "<p>" + row.clear_password + "</p>",
                    "Close");
    }

    function anonCallback(callback=function(){}, callbackArgs=null) {
        if(callbackArgs) {
            callback.apply(this, callbackArgs);
        } else { 
            callback();
        }
    }

    // Wrapper to execute multiple searches in order and resolve when they've all finished
    function all(array){
        console.log("Array");
        console.log(array);
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

    function isFormOpen() {
        var formOpen = window.sessionStorage.getItem("formOpen");
        if(_.isNull(formOpen) || _.isUndefined(formOpen) || formOpen === "false") {
            console.log("Form not open - returning false");
            return false;
        } else {
            console.log("Form is open - returning true");
            return true;
        }
    }

    function execMultiSearch(components) {
        var dfd = $.Deferred();

        // push individual searches
        var promises = [];

        _.each(components, function(component, i) {
            console.log(component);
            promises.push(function() {
                return execSearch(component);
            });    
        });

        // 
        $.when(all(promises)).then(function(components) {
            dfd.resolve(components);
        });
        
        return dfd.promise();
    }

    function execSearch(component) {
        var dfd = $.Deferred();
        if(!component.config.searchString) {
            dfd.resolve(component);
        }

        var searchId = "generic-search-" + component.config.id;
        var componentExists = mvc.Components.getInstance(searchId);
        
        if(!componentExists) {
            var genericSearch = new SearchManager({
                id: searchId,
                search: component.config.searchString,
                cache: false
            });
        }

        var mainSearch = splunkjs.mvc.Components.getInstance(searchId);
        var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

        mainSearch.on('search:done', function(properties) {

            if(properties.content.resultCount == 0) {
                component.config.data = [];
                dfd.resolve(component);
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            component.config.data = data;
            dfd.resolve(component);
        });

        return dfd.promise();
    }

    function renderCreateModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {
        var myModal = new Modal(id, {
                    title: title,
                    destroyOnHide: true,
                    type: 'wide'
        }); 
    
        myModal.body.append($(body));
    
        return myModal;
    }

    function renderModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {

        var myModal = new Modal(id, {
                    title: title,
                    destroyOnHide: true,
                    type: 'wide'
        }); 
    
        myModal.body.append($(body));
    
        // Add cancel button for update/delete action
        if(id == "user-delete-confirm" || id == "update-user-form") {
            myModal.footer.append($('<cancel>').attr({
                type: 'button',
                'data-dismiss': 'modal'
            })
            .addClass('btn btn-secondary').text("Cancel")).on('click', function(){});
        }

        myModal.footer.append($('<button>').attr({
            type: 'button',
            'data-dismiss': 'modal'
        })
        .addClass('btn btn-primary').text(buttonText).on('click', function () {
                anonCallback(callback, callbackArgs); 
        }))

        myModal.show(); // Launch it!  
    }

    function clearOnClickAndRegister(el, callback, callbackArgs=null) {
        console.log($._data($(el).get(0), "events"));
        //console.log($._data($(el).get(0), "events").click);
        if(_.isUndefined($._data($(el).get(0), "events"))) {
            $(el).on('click', function () {
                anonCallback(callback, callbackArgs);
            });
            return;    
        }

        if(_.isObject($._data($(el).get(0), "events")) && _.has($._data($(el).get(0), "events"), "click")) {
            console.log("Unregistering click callback");
            $(el).off('click');
            $(el).on('click', function () {
                anonCallback(callback, callbackArgs);
            });
        }
    }
    

    /* Run Search */
    function runSearch() {
        window.sessionStorage.setItem("formOpen", "false");
        var contextMenuDiv = '#context-menu';
        var passwordTableDiv = '#password-table';

        // | rest /servicesNS/-/-/authentication/users | table title | rename title as user
        // | rest /servicesNS/-/-/apps/local | table title, label | rename title as app_name, label as app_description
        
        var search1 = new SearchManager({
                "id": "search1",
                "cancelOnUnload": true,
                "status_buckets": 0,
                "earliest_time": "-24h@h",
                "latest_time": "now",
                "sample_ratio": 1,
                "search": "| rest /servicesNS/-/-/storage/passwords \
                | table username, password, realm, clear_password, eai:acl.app, eai:acl.owner, eai:acl.perms.read, eai:acl.perms.write, eai:acl.sharing \
                | rename eai:acl.app as app, eai:acl.owner as owner, eai:acl.perms.read as acl_read, eai:acl.perms.write as acl_write, eai:acl.sharing as acl_sharing \
                | append [| rest /servicesNS/-/-/configs/conf-passwords \
                    | rex field=title \"credential:(?<realm>.*?):(?<username>.*?):\" \
                    | fields username, eai:userName, password, realm, eai:acl.app, eai:acl.owner, eai:acl.perms.read, eai:acl.perms.write, eai:acl.sharing, realm \
                    | rename eai:userName as user, eai:acl.app as app, eai:acl.owner as owner, eai:acl.perms.read as acl_read, eai:acl.perms.write as acl_write, eai:acl.sharing as acl_sharing \
                    | eval owner=if(owner=user, owner, user) \
                    | table username, password, realm, app, owner, acl_read, acl_write, acl_sharing] \
                | dedup username, realm",
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
                console.log("No Results");
                var noData = null;
                createTable(passwordTableDiv, contextMenuDiv, noData);
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            createTable(passwordTableDiv, contextMenuDiv, data);
        });
    }

    function createTable(tableDiv, contextMenuDiv, data) {
        var html = '<p> Click <b>Create</b> to add a user or right click on a row to create, update or delete.</p> \
                    <p><button id="main-create" class="btn btn-primary" data-toggle="collapse" href="#create-update-form">Create</button></p> \
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
                          <button id="create-submit" class="btn btn-primary">Submit</button> \
                        </div> \
                        </form> \
                      </div> \
                    </div>';                      

        var tdHtml = "";
        var contextMenu = '<ul id="example1-context-menu" class="dropdown-menu"> \
                             <li data-item="update"><a>Update</a></li> \
                             <li data-item="delete"><a>Delete</a></li> \
                           </ul>';
        var header = '<table id="rest-password-table" \
                             class="table table-striped table-hover" \
                             data-toolbar="#toolbar" \
                             data-sort-name="username" \
                             data-show-pagination-switch="true" \
                             data-id-field="id" \
                             data-pagination="true" \
                             data-sortable="true" \
                             data-page-size="10" \
                             data-page-list="[10, 25, 50, 100, ALL]" \
                             data-id-field="id" \
                             data-smart-display="true" \
                             data-search="true" \
                             data-show-footer="false"> \
                      <thead> \
                        <tr> \
                            <th data-field="id" data-visible="false"><div><h3>ID</h3></div></th> \
                            <th data-field="username" data-sortable="true"><div><h3>Username</h3></div></th> \
                            <th data-field="password" data-events="operateEvents"><div><h3>Password</h3></div></th> \
                            <th data-field="realm" data-sortable="true"><div><h3><h3>Realm</h3></div></th> \
                            <th data-field="app" data-sortable="true"><div><h3>App</h3></div></th> \
                            <th data-field="clear_password" data-visible="false"><div><h3>Clear Password</h3></div></th> \
                            <th data-field="owner" data-sortable="true"><div><h3>Owner</h3></div></th> \
                            <th data-field="acl_read" data-sortable="true"><div><h3>Read</h3></div></th> \
                            <th data-field="acl_write" data-sortable="true"><div><h3>Write</h3></div></th> \
                            <th data-field="acl_sharing" data-sortable="true"><div><h3>Sharing</h3></div></th> \
                        </tr> \
                      </thead> \
                      <tbody>';
        html += header;
        _.each(data, function(row, i) {
            tdHtml += '<tr class="striped"> \
                         <td>' + i + '</td> \
                         <td>' + row.username + '</td> \
                         <td> \
                           <a class="show" href="javascript:void(0)" title="Show Password"> \
                             <li class="icon-visible"></li> \
                           </a> \
                         </td> \
                         <td>' + row.realm + '</td> \
                         <td>' + row.app + '</td> \
                         <td>' + row.clear_password + '</td> \
                         <td>' + row.owner + '</td> \
                         <td>' + row.acl_read + '</td> \
                         <td>' + row.acl_write + '</td> \
                         <td>' + row.acl_sharing + '</td> \
                       </tr>';
        });
        
        tdHtml += "</tbody></table>";
        html += tdHtml;
        
        $(tableDiv).append(html);
        $(contextMenuDiv).append(contextMenu);
        $('#main-create').on('click', function () { 
            // var formOpen = window.sessionStorage.getItem("formOpen");
            // if(_.isUndefined(formOpen)) {
            //     formOpen = false;
            // }

            // console.log("form open:" + formOpen);

            //if(formOpen == "true") {
            if(!isFormOpen()) {
                $('#main-create').text("Close");
                window.sessionStorage.setItem("formOpen", "true");

                // Clear form values
                $('input[id=createUsername]').val("");
                $('input[id=createRealm]').val("");        
                //console.log(window.sessionStorage.getItem("formOpen"));
            } else {
                $('#main-create').text("Create");
                window.sessionStorage.setItem("formOpen", "false");
                //console.log(window.sessionStorage.getItem("formOpen"));
            }
            
            anonCallback(renderCreateUserForm, ["",""])
        });

        $('#rest-password-table').bootstrapTable({
            contextMenu: '#example1-context-menu',
            onContextMenuItem: function(row, $el){
                if($el.data("item") == "update"){
                    renderUpdateUserForm(row);
                } else if($el.data("item") == "delete"){
                    deleteCredential(row, tableDiv);
                }
            }
        });
    }

    // Callback to refresh window and hide create-user
    function refreshWindow() {
        setTimeout(function () {
            location.reload()
            $('#create-user').show();
        }, 500);
    }

    function deleteCredential(row, tableDiv) {
        var username=Splunk.util.getConfigValue("USERNAME");      
        var deleteUrl = "/en-US/splunkd/__raw/servicesNS/" + username + "/" + row.app + "/storage/passwords/" + row.realm + ":" + row.username +":";

        var removeUser = function () {
            $.ajax({
                type: "DELETE",
                url: deleteUrl,
                success: function() {
                    renderModal("user-deleted",
                                "User Deleted",
                                "<p>Successfully deleted user " + row.username + ":" + row.realm + "</p>",
                                "Close",
                                refreshWindow) 
                },
                error: function() {
                    alert("Failed to delete user " + row[0] + ". See console for details");
                }
            });
        }

        var deleteUser = renderModal("user-delete-confirm",
                                     "Confirm Delete Action",
                                     "<p>You're about to remove the user " + row.username + ":" + row.realm + " - Press ok to continue</p>",
                                     "Ok",
                                     removeUser);
    }

    function splunkJSInput(config) {
        var config = this.config = config;
        var that = this;

        this.remove = function() {
            var el = "#" + this.config.parentEl;
            var splunkJsComponent = mvc.Components.get(this.config.id);
            if(splunkJsComponent) {
                console.log("Removing component " + this.config.id);
                splunkJsComponent.remove();
                $(el).append('<div id="' + this.config.el + '"></div>');    
            }
        }

        this.waitForElAndRender = function() {        
            var el = "#" + this.config.el;

            if ($(el).length) {
                var choices = _.has(this.config, "data") ? this.config.data:this.config.choices;    
                console.log("Rendering " + this.config.id);
    
                if(this.config.type == "dropdown") {
                    this.config.instance = new DropdownView({
                        id: this.config.id,
                        choices: choices,
                        labelField: "label",
                        valueField: "value",
                        default: _.has(this.config, "default") ? this.config.default:null,
                        el: $(el)
                    }).render();                       
                } else {
                    if(this.config.id == "read-user-multi") {
                        choices.unshift({"label":"*", "value":"*"});
                    }
                    this.config.instance = new MultiDropdownView({
                        id: this.config.id,
                        choices: choices,
                        labelField: "label",
                        valueField: "value",
                        width: 350,
                        default: _.has(this.config, "default") ? this.config.default:null,
                        el: $(el)
                    }).render();         
                }
            } else {
                setTimeout(function() {
                    that.waitForElAndRender();
                }, 100);
            }
        }

        this.getVals = function() {
            return this.config.instance.val();
        }
    }


    function renderCreateUserForm(cUsername = false, cRealm = false) {
        var createUser = function createUser() {
            event.preventDefault();
            console.log(arguments);
        
            var aclData = {};

            _.each(arguments[2], function(component, i) {
                var aclKey = component.config.aclKey;
                aclData[aclKey] = _.isArray(component.getVals()) ? component.getVals().join():component.getVals();
            });

            console.log(aclData);

            // _.each(formKeys, function(key, i) {
            //     _.find(arguments[2], function(v) {
            //         console.log(v.config.id);
            //         if(v.config.id == key) {
            //             console.log("Found read-multi-user ");
            //             console.log(v);
            //             console.log(v.getVals());
            //         }
            //     })
            // });

            var username = $('input[id=createUsername]').val();
            var password = $('input[id=createPassword]').val();
            var confirmPassword = $('input[id=createConfirmPassword]').val();
            var realm = $('input[id=createRealm]').val();
            
            if(username == "") {
                return renderModal("missing-username",
                                    "Missing Username",
                                    "<p>Please enter a username</b>",
                                    "Close",
                                    renderCreateUserForm);
            }

            if(password == "") {
                return renderModal("missing-password",
                                    "Missing Password",
                                    "<p>Please enter a password</b>",
                                    "Close",
                                    renderCreateUserForm);
            }

            var formData = {"name": username,
                            "password": password,
                            "realm": realm};

            console.log(password, confirmPassword);
            if(password != confirmPassword) {
                return renderModal("password-mismatch",
                                    "Password Mismatch",
                                    "<p>Passwords do not match</b>",
                                    "Close",
                                    renderCreateUserForm,
                                    [username, realm]);
            } else {
                var currentUser = Splunk.util.getConfigValue("USERNAME");      
                var app = utils.getCurrentApp();
                //var createUrl = "/en-US/splunkd/__raw/servicesNS/" + currentUser + "/" + app + "/storage/passwords";
                var createUrl = "/en-US/splunkd/__raw/servicesNS/" + aclData.owner + "/" + aclData.app + "/storage/passwords";
                var aclUrl = "/en-US/splunkd/__raw/servicesNS/" + aclData.owner + "/" + aclData.app + "/configs/conf-passwords/credential%3A" + realm + "%3A" + username + "%3A/acl";
                // https://localhost:8089/servicesNS/admin/password-manager/configs/conf-passwords/credential%3A%3Afoo%3A/acl -d owner=admin -d perms.read=admin,shaskell -d sharing=app
                delete aclData.app; 

                console.log(aclData);

                $.ajax({
                    type: "POST",
                    url: createUrl,
                    data: formData,
                    success: function() {
                        renderModal("user-added",
                                    "User Created",
                                    "<p>Successfully created user " + username + ":" + realm + "</p>",
                                    "Close",
                                    refreshWindow);
                    },
                    error: function(e) {
                        console.log(e);
                        renderModal("user-add-fail",
                                    "Failed User Creation",
                                    "<p>Failed to create user " + username + ":" + realm + "</p><br><p>" + e.responseText + "</p>",
                                    "Close");
                    }
                })
                .then(function() {
                    $.ajax({
                        type: "POST",
                        url: aclUrl,
                        data: aclData,
                        success: function() {
                            renderModal("user-deleted",
                                        "User Deleted",
                                        "<p>Successfully applied ACL's to " + aclData + " - " + username + ":" + realm + "</p>",
                                        "Close") 
                        },
                        error: function(e) {
                            console.log(e);
                            renderModal("acl-update-fail",
                                    "Failed To Apply ACL",
                                    "<p>Failed to apply ACL</p><br><p>" + e.responseText + "</p>",
                                    "Close");
                        }
                    })                
                });
            }
        }

        // var html = '<form id="createCredential"> \
        //                 <div class="form-group"> \
        //                   <label for="username">Username</label> \
        //                   <input type="username" class="form-control" id="createUsername" placeholder="Enter username"> \
        //                 </div> \
        //                 <p></p> \
        //                 <div class="form-group"> \
        //                   <label for="password">Password</label> \
        //                   <input type="password" class="form-control" id="createPassword" placeholder="Password"> \
        //                 </div> \
        //                 <div> \
        //                   <label for="confirmPassword">Confirm Password</label> \
        //                   <input type="password" class="form-control" id="createConfirmPassword" placeholder="Confirm Password"> \
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="realm">Realm</label> \
        //                   <input type="realm" class="form-control" id="createRealm" placeholder="Realm"> \
        //                   <br></br>\
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="owner">Owner</label> \
        //                   <div id="owner-dropdown"></div> \
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="readUsers">Read Users</label> \
        //                   <div id="read-user-multi"></div> \
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="writeUsers">Write Users</label> \
        //                   <div id="write-user-multi"></div> \
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="appScope">App Scope</label> \
        //                   <div id="app-scope-dropdown"></div> \
        //                 </div> \
        //                 <div class="form-group"> \
        //                   <label for="sharing">Sharing</label> \
        //                   <div id="sharing-dropdown"></div> \
        //                 </div> \
        //             </form>';

        var inputs = [new splunkJSInput({"id": "app-scope-dropdown",
                       "searchString": "| rest /servicesNS/-/-/apps/local | rename title as value | table label, value",
                       "el": "app-scope-dropdown",
                       "type": "dropdown",
                       "default": utils.getCurrentApp(),
                       "aclKey": "app",
                       "parentEl": "app-scope"}),
                       new splunkJSInput({"id": "read-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "read-user-multi",
                        "type": "multi-dropdown",
                        "default": "*",
                        "aclKey": "perms.read",
                        "parentEl": "read-users"}),
                       new splunkJSInput({"id": "write-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "write-user-multi",
                        "type": "multi-dropdown",
                        "parentEl": "write-users",
                        "aclKey": "perms.write",
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
                        "searchString": "| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | table label, value",
                        "el": "owner-dropdown",
                        "type": "dropdown",
                        "aclKey": "owner",
                        "default": Splunk.util.getConfigValue("USERNAME"),
                        "parentEl": "owner"})];

        // Remove component if it exists
        _.each(inputs, function(input, i) {
            input.remove();
        });

        // Fire searches and render splunkJS form components to modal
        $.when(execMultiSearch(inputs)).done(function(components) {
            _.each(components, function(component, i) {
                component.waitForElAndRender();
            });

            clearOnClickAndRegister('#create-submit', createUser, [cUsername, cRealm, inputs]);
        });
    
        setTimeout(function () {
            if(cUsername != "" || cRealm != "") {
                $('input[id=createUsername]').val(cUsername);
                $('input[id=createRealm]').val(cRealm);
            }
        }, 300);
    }

    function renderUpdateUserForm(row) {
        var updateUser = function updateUser () {
            event.preventDefault();
            // $('input[id=createUsername]').val(row.username);
            // $('input[id=createRealm]').val(row.realm);
            // $('input[id=createApp]').val(row.app);

            var formVals = {};
            var aclData = {};

            _.each(arguments[0], function(component, i) {
                var aclKey = component.config.aclKey;
                aclData[aclKey] = _.isArray(component.getVals()) ? component.getVals().join():component.getVals();
                formVals[aclKey] = component.config.default.join();
            });            

            formVals.realm = arguments[1].realm;
            var username = $('input[id=createUsername]').val();
            var password = $('input[id=createPassword]').val();
            var confirmPassword = $('input[id=createConfirmPassword]').val();
            var realm = $('input[id=createRealm]').val();
            var aclApp = aclData.app;
            var app = formVals.app;

            if(aclData.sharing === "user" && password) {
                return renderModal("sharing-scope-error",
                                   "Sharing Error",
                                   "<p>Set sharing to App or Global before changing password.<p>",
                                   "Close")
            }
            // var username = $('input[id=updateUsername]').val();
            // var password = $('input[id=updatePassword]').val();
            // var confirmPassword = $('input[id=updateConfirmPassword]').val();
            // var realm = $('input[id=updateRealm]').val();
            //var app = $('input[id=updateApp]').val();

            //var formData = {"password": password};

            // if(password == "") {
            //     return renderModal("password-missing",
            //                        "Empty Password",
            //                        "<p>Empty password. Please re-enter<p>",
            //                        "Close",
            //                        renderUpdateUserForm,
            //                        [row]);
            // }

            if(password != confirmPassword) {
                renderModal("password-mismatch",
                            "Password Mismatch",
                            "<p>Passwords do not match. Please re-enter.<p>",
                            "Close",
                            renderUpdateUserForm,
                            [arguments[1]]); 
            } else {
                var currentUser = Splunk.util.getConfigValue("USERNAME"); 
                console.log(row);
                var url = "/en-US/splunkd/__raw/servicesNS/" + formVals.owner + "/" + formVals.app + "/storage/passwords/" + formVals.realm + ":" + username + ":";
                var aclUrl = "/en-US/splunkd/__raw/servicesNS/" + formVals.owner + "/" + formVals.app + "/configs/conf-passwords/credential%3A" + formVals.realm + "%3A" + username + "%3A/acl";
                var moveUrl = "/en-US/splunkd/__raw/servicesNS/" + formVals.owner + "/" + formVals.app + "/configs/conf-passwords/credential%3A" + formVals.realm + "%3A" + username + "%3A/move";
                delete aclData.app; 
                console.log(url);

                if(password) { 
                    $.ajax({
                        type: "POST",
                        url: aclUrl,
                        data: aclData,
                        success: function() {
                            console.log(aclUrl);
                            renderModal("user-deleted",
                                        "User Deleted",
                                        "<p>Successfully applied ACL's to " + aclData + " - " + username + ":" + realm + "</p>",
                                        "Close") 
                        },
                        error: function(e) {
                            console.log(e);
                            renderModal("acl-update-fail",
                                    "Failed To Apply ACL",
                                    "<p>Failed to apply ACL</p><br><p>" + e.responseText + "</p>",
                                    "Close");
                        }
                    })
                    .then (function() {
                        $.ajax({
                            type: "POST",
                            url: url,
                            data: {"password": password},
                            success: function() {
                                renderModal("password-updated",
                                            "Password Updated",
                                            "<p>Password successfully updated password for user " + username + ":" + app + "</p>",
                                            "Close",
                                            refreshWindow);
                            },
                            error: function(e) {
                                console.log(e);
                                renderModal("password-updated",
                                            "Password Updated",
                                            "<p>Failed to update password for user " + username + ". " + e.responseText,
                                            "Close",
                                            refreshWindow);
                            }
                        })                                         
                    })
                    .done(function() {
                        console.log("Form vals app: " + formVals.app + " Acl data app: " + aclApp);
                        if(formVals.app != aclApp) {
                            console.log("Form vals app: " + formVals.app + " Acl data app: " + aclApp);
                            $.ajax({
                                type: "POST",
                                url: moveUrl,
                                data: {"app": aclApp, "user": "nobody"},
                                success: function() {
                                    renderModal("user-deleted",
                                                "User Deleted",
                                                "<p>Successfully moved credential from " + formVals.app + " to " + aclApp + "</p>",
                                                "Close") 
                                },
                                error: function(e) {
                                    console.log(e);
                                    console.log(moveUrl);
                                    renderModal("acl-update-fail",
                                            "Failed To Apply ACL",
                                            "<p>Failed to move credential from " + formVals.app + " to " + aclApp + "</p>",
                                            "Close");
                                }
                            })
                        }
                    });
                } else {
                    $.ajax({
                        type: "POST",
                        url: aclUrl,
                        data: aclData,
                        success: function() {
                            renderModal("user-deleted",
                                        "User Deleted",
                                        "<p>Successfully applied ACL's to " + aclData + " - " + username + ":" + realm + "</p>",
                                        "Close") 
                        },
                        error: function(e) {
                            console.log(e);
                            renderModal("acl-update-fail",
                                    "Failed To Apply ACL",
                                    "<p>Failed to apply ACL</p><br><p>" + e.responseText + "</p>",
                                    "Close");
                        }
                    })
                } 
            }
        }
        // var html = '<form id="updateCredential"> \
        //               <div class="form-group"> \
        //                 <input type="hidden" class="form-control" id="updateUsername"> \
        //               </div> \
        //               <p></p> \
        //               <div class="form-group"> \
        //                 <label for="password">Password</label> \
        //                 <input type="password" class="form-control" id="updatePassword" placeholder="Password"> \
        //               </div> \
        //               <div> \
        //                 <label for="confirmPassword">Confirm Password</label> \
        //                 <input type="password" class="form-control" id="updateConfirmPassword" placeholder="Confirm Password"> \
        //               </div> \
        //               <div> \
        //                 <input type="hidden" class="form-control" id="updateRealm"> \
        //               </div> \
        //               <div class="form-group"> \
        //                 <input type="hidden" class="form-control" id="updateApp"> \
        //               </div> \
        //             </form>'

        // var randomId = 100 + ~~(Math.random() * 100);
        // $('#rest-password-table').bootstrapTable('insertRow', {
        //         index: 1,
        //         row:{}
        //     });

        // renderModal("update-user-form",
        //             "Update User",
        //             html,
        //             "Update",
        //             updateUser);

        console.log(row);

        if(!isFormOpen()) {
            $('#create-update-form').collapse('show');
            $('#main-create').text("Close");
            window.sessionStorage.setItem("formOpen", "true");
        } else {
            $('#create-update-form').collapse('hide');
            setTimeout(function() {
                $('#create-update-form').collapse('show');
                $('#main-create').text("Close");
                window.sessionStorage.setItem("formOpen", "true");
            }, 700) 
        }

        // Set form username and realm
        $('input[id=createUsername]').val(row.username);
        $('input[id=createRealm]').val(row.realm);

        var inputs = [new splunkJSInput({"id": "app-scope-dropdown",
                       "searchString": "| rest /servicesNS/-/-/apps/local | rename title as value | table label, value",
                       "el": "app-scope-dropdown",
                       "type": "dropdown",
                       "default": [row.app],
                       "aclKey": "app",
                       "parentEl": "app-scope"}),
                       new splunkJSInput({"id": "read-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "read-user-multi",
                        "type": "multi-dropdown",
                        "default": row.acl_read.split(','),
                        "aclKey": "perms.read",
                        "parentEl": "read-users"}),
                       new splunkJSInput({"id": "write-user-multi",
                        "searchString": "| rest /servicesNS/-/-/authorization/roles | eval label=title | rename title as value | fields label, value | append [| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | fields label, value] | dedup label",
                        "el": "write-user-multi",
                        "type": "multi-dropdown",
                        "parentEl": "write-users",
                        "aclKey": "perms.write",
                        "default": row.acl_write.split(',')}),
                       new splunkJSInput({"id": "sharing-dropdown",
                        "choices": [{"label":"global", "value": "global"},
                                    {"label":"app", "value": "app"},
                                    {"label":"user", "value": "user"}],
                        "el": "sharing-dropdown",
                        "type": "dropdown",
                        "parentEl": "sharing",
                        "aclKey": "sharing",
                        "default": [row.acl_sharing]}),
                       new splunkJSInput({"id": "owner-dropdown",
                        "searchString": "| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | table label, value",
                        "el": "owner-dropdown",
                        "type": "dropdown",
                        "default": [row.owner],
                        "aclKey": "owner",
                        "parentEl": "owner"})];

        // Remove component if it exists
        _.each(inputs, function(input, i) {
            input.remove();
        });

        // Fire searches and render splunkJS form components to modal
        $.when(execMultiSearch(inputs)).done(function(components) {
            _.each(components, function(component, i) {
                component.waitForElAndRender();
            });

            clearOnClickAndRegister('#create-submit', updateUser, [inputs, row]);
        });

        

        //if(formOpen == "true") {
            // if(!isFormOpen()) {
            //     $('#main-create').text("Close");
            //     window.sessionStorage.setItem("formOpen", "true");
            //     //console.log(window.sessionStorage.getItem("formOpen"));
            // } else {
            //     $('#main-create').text("Create");
            //     window.sessionStorage.setItem("formOpen", "false");
            //     //console.log(window.sessionStorage.getItem("formOpen"));
            // }
        

        
    }

    window.operateEvents = {
        'click .show': function (e, value, row, index) {
            console.log(row);
            showPassword(row);
        }
    };

    runSearch();

});
