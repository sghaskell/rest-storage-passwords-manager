'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

define(['underscore'], function (_) {
    return function () {
        /**
         * A utility wrapper around Bootstrap's modal.
         * @param {string|object} id                            Either an id or a jQuery element that contains the id in its "data-target" attribute
         * @param {object}         [options]                    Bootstrap modal options
         * @param {boolean|string} [options.backdrop]           Whether or not to show a backdrop, or the string "static" to show a backdrop that doesn't close the modal when clicked
         * @param {boolean}        [options.keyboard]           Whether or not the escape key clsoes the modal
         * @param {boolean}        [options.show=false]         Whether or not to show the modal when it's created
         * @param {string}         [options.type='normal']      Can be 'normal', 'wide', or 'noPadding'
         * @param {string}         [options.title]              The modal's title
         * @param {boolean}        [options.destroyOnHide=true] Destroy the modal when it's hidden
         * @returns {element}
         */
        function Modal(id, options) {
            var _this = this;

            _classCallCheck(this, Modal);

            var modalOptions = _.extend({ show: false }, options);

            // if "id" is the element that triggers the modal display, extract the actual id from it; otherwise use it as-is
            var modalId = id != null && (typeof id === 'undefined' ? 'undefined' : _typeof(id)) === 'object' && id.jquery != null ? id.attr('data-target').slice(1) : id;

            var header = $('<div>').addClass('modal-header');

            var headerCloseButton = $('<button>').addClass('close').attr({
                'type': 'button',
                'data-dismiss': 'modal',
                'aria-label': 'Close'
            }).append($('<span>').attr('aria-hidden', true).text('&times;'));

            this.title = $('<h3>').addClass('modal-title');

            this.body = $('<div>').addClass('modal-body');

            this.footer = $('<div>').addClass('modal-footer');

            this.$el = $('<div>').addClass('modal hid fade mlts-modal').attr('id', modalId).append($('<div>').addClass('modal-dialog').append($('<div>').addClass('modal-content').append(header.append(headerCloseButton, this.title), this.body, this.footer)));

            if (modalOptions.title != null) this.setTitle(modalOptions.title);

            if (modalOptions.type === 'wide') this.$el.addClass('modal-wide');else if (modalOptions.type === 'noPadding') this.$el.addClass('mlts-modal-no-padding');

            // remove the modal from the dom after it's hidden
            if (modalOptions.destroyOnHide !== false) {
                this.$el.on('hidden.bs.modal', function () {
                    return _this.$el.remove();
                });
            }

            this.$el.modal(modalOptions);
        }

        _createClass(Modal, [{
            key: 'setTitle',
            value: function setTitle(titleText) {
                this.title.text(titleText);
            }
        }, {
            key: 'setAlert',
            value: function setAlert(alertMessage, alertType) {
                if (this.alert == null) {
                    this.alert = $('<div>').addClass('mlts-modal-alert');
                    this.body.prepend(this.alert);
                }

                //Messages.setAlert(this.alert, alertMessage, alertType, undefined, true);
            }
        }, {
            key: 'removeAlert',
            value: function removeAlert() {
                //Messages.removeAlert(this.alert, true);
            }
        }, {
            key: 'show',
            value: function show() {
                this.$el.modal('show');
            }
        }, {
            key: 'hide',
            value: function hide() {
                this.$el.modal('hide');
            }
        }]);

        return Modal;
    }();
});
