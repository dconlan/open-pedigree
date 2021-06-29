/**
 * The saveLoadEngine allows to save and load from local storage.
 * This module creates an object that will act as an adapter to allow transfer via messages.
 * The module will wait for messages and update the local storage based on those messages.
 */

var MessageToLocalAdapter = Class.create({

  initialize: function (localStorageKey) {
    console.log('Init MessageToLocalAdapter');
    this._localStorageKey = localStorageKey;


    const refURL = new URL(document.referrer);
    this._messageOrigin = refURL.origin;
    const me = this;
    if (window.opener) {
      window.addEventListener('message', function (event) {
        if (me) {
          me.handleMessageEvent(event);
        }

      }, false);
    }
    document.observe('pedigree:save:complete', function () {
      if (me) {
        me.handleStorageMessage();
      }
    });
  },
  start: function () {
    console.log('Posting start message');
    window.opener.postMessage({messageType: 'open_pedigree_control', message: 'started'}, this._messageOrigin);
  },

  handleMessageEvent: function (event) {
    console.log('Got message event');
    console.log(event);
    if (event.source === window.opener && event.origin === this._messageOrigin) {
      // the message is from our opener
      if (event.data.messageType === 'open_pedigree_data') {
        console.log('Setting local storage and fir reload');
        localStorage.setItem(this._localStorageKey, event.data.openPedigreeData);
        document.fire('pedigree:reload');
      } else if (event.data.messageType === 'open_pedigree_control') {
        if (event.data.message === 'load') {
          document.fire('pedigree:reload');
        }
      }
    }
  },

  handleStorageMessage: function (event) {
    // storage event means the data has been saved and we need to send a message
    // pass message to opener
    if (window.opener) {
      console.log('Sending pedigree data via a message');
      window.opener.postMessage({
        messageType: 'open_pedigree_data',
        openPedigreeData: localStorage.getItem(this._localStorageKey)
      }, this._messageOrigin);
    }
  },


});

export default MessageToLocalAdapter;
