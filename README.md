# Splunk REST storage/passwords Manager

## About

The password manager app provides a Javascript CRUD interface to the [Splunk storage/passwords REST endpoint](http://docs.splunk.com/Documentation/Splunk/7.0.3/RESTREF/RESTaccess#storage.2Fpasswords). 

## Dependencies
To store passwords the user must have the `admin_all_objects` capability enabled within an assigned role. To read passwords a user must have `list_storage_passwords` capabilty enabled within an assigned role.

## Usage
The Credential Management dashboard provides a CRUD interface to create, update and delete credentials to be used within Splunk apps. 

#### Create Credential
Simply click the create button to reveal the credential creation form.

![Alt text](appserver/static/img/credential_management-tour:enterprise/credential-create.png?raw=true)

Fill out the form specifying a username, password and optionally a realm. The realm can be used as a descriptor for the credential or left blank; e.g., prod or dev. The form will populate with sane defaults for owner, read users, write users, app scope and sharing. You can update them to whatever you like, including the target app context, before you hit create. If you set sharing to `user` you will not be able to update the password without changing the sharing scope back to `app` or `global`. This is a limitation with Splunk's REST API, not the app. 

![Alt text](appserver/static/img/credential_management-tour:enterprise/create-form.png?raw=true)

![Alt text](appserver/static/img/credential_management-tour:enterprise/create-success-modal.png?raw=true)

Once created, the dashboard will be refreshed automatically. 

![Alt text](appserver/static/img/credential_management-tour:enterprise/table.png?raw=true)

#### Update Credential

Right click on a table entry to reveal a context menu that allows you to update the credential. 

![Alt text](appserver/static/img/credential_management-tour:enterprise/context-update.png?raw=true)

Alternately, you can click the detail view (plus icon) in the table to update the credential.

![Alt text](appserver/static/img/credential_management-tour:enterprise/detail-view.png?raw=true)

The update form will be rendered under the selected row in the table. You can change the password, any of the permissions or the app context when updating. The realm is the only field that cannot be changed. This is a limitation of the storage/passwords REST endpoint, not the app. You don't have to set the password to update the ACL's on the credential or move between apps. Simply choose new permissions or app scope and hit update.

![Alt text](appserver/static/img/credential_management-tour:enterprise/inline-update.png?raw=true)

#### Delete Credential

Right click on a table entry to reveal a context menu that allows you to delete the credential. 

![Alt text](appserver/static/img/credential_management-tour:enterprise/context-delete.png?raw=true)

Alternately, select any individual credential or select all using the checkbox in the header column and press the delte button.

![Alt text](appserver/static/img/credential_management-tour:enterprise/multi-delete.png?raw=true)

![Alt text](appserver/static/img/credential_management-tour:enterprise/multi-delete-confirm.png?raw=true)

#### Reveal Clear Password

Click the eye icon to view the plain text password.

![Alt text](appserver/static/img/credential_management-tour:enterprise/show-password.png?raw=true)

![Alt text](appserver/static/img/credential_management-tour:enterprise/clear-password-modal.png?raw=true)

## Using Stored Passwords
Please see this [awesome blog post](http://www.georgestarcher.com/splunk-stored-encrypted-credentials/) on using your newly stored credentials. When all else fails, dig into [dev.splunk.com](http://dev.splunk.com/search/?q=storage%2Fpasswords&l=en&submit=Search) for more details.

##Support

### Feature Requests
Please [submit feature requests through Github](https://github.com/sghaskell/rest-storage-passwords-manager/labels/enhancement) using the ``enhancement`` label so they can be tracked and discussed.

### Bugs
Please [submit bugs through Github](https://github.com/sghaskell/rest-storage-passwords-manager/labels/bug) using the ``bug`` label so they can be tracked and discussed.

###### For all other inquiries
Scott Haskell ([shaskell@splunk.com](mailto:shaskell@splunk.com))
###### [Code hosted at Github](https://github.com/sghaskell/rest-storage-passwords-manager)