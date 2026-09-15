/*!
 * Meeting Cost — Outlook add-in task pane
 *
 * Reads the open appointment through Office.js (attendees, organizer,
 * start, end, subject) in both read mode (an invitation you received) and
 * compose mode (a meeting you are creating), computes the cost with the
 * shared core, and keeps the number ticking.
 */
(function () {
  'use strict';

  var core = window.MeetingCostCore;
  var SETTINGS_KEY = 'meetingCostConfig';
  var FIELDS = ['defaultHourlyRate', 'currency', 'hoursPerYear', 'overheadMultiplier', 'tickSeconds',
    'overrunGraceMinutes', 'includeDeclined', 'includeResources'];

  var state = { config: core.normalizeConfig({}), data: null, computed: null, ticker: null, self: '' };
  var $ = function (id) { return document.getElementById(id); };

  /* ---- Office bootstrap ---------------------------------------------- */

  Office.onReady(function (info) {
    var item = Office.context.mailbox && Office.context.mailbox.item;
    if (info.host !== Office.HostType.Outlook || !item || item.itemType !== Office.MailboxEnums.ItemType.Appointment) {
      $('unsupported').hidden = false;
      return;
    }
    $('app').hidden = false;
    state.self = (Office.context.mailbox.userProfile && Office.context.mailbox.userProfile.emailAddress || '').toLowerCase();
    state.config = loadConfig();
    fillSettings(state.config);
    wireUi();
    refreshItem();

    // Compose mode (Mailbox 1.7+): recompute as people or times change.
    if (typeof item.addHandlerAsync === 'function' && Office.EventType) {
      ['RecipientsChanged', 'AppointmentTimeChanged'].forEach(function (name) {
        if (!Office.EventType[name]) return;
        try { item.addHandlerAsync(Office.EventType[name], refreshItem); } catch (err) { /* older host */ }
      });
    }
  });

  /* ---- settings (roaming, per mailbox) ------------------------------ */

  function loadConfig() {
    var rs = Office.context.roamingSettings;
    var raw = rs ? rs.get(SETTINGS_KEY) : null;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (err) { raw = null; } }
    return core.normalizeConfig(raw || {});
  }

  function saveConfig(cfg, done) {
    var rs = Office.context.roamingSettings;
    if (!rs) return done(new Error('Roaming settings unavailable'));
    rs.set(SETTINGS_KEY, JSON.stringify(cfg));
    rs.saveAsync(function (result) {
      done(result.status === Office.AsyncResultStatus.Succeeded ? null : new Error(result.error && result.error.message));
    });
  }

  function fillSettings(cfg) {
    FIELDS.forEach(function (id) {
      var input = $(id);
      if (input.type === 'checkbox') input.checked = !!cfg[id]; else input.value = cfg[id];
    });
    $('rates').value = core.serializeRateLines(cfg.rates);
  }

  function readSettings() {
    var parsed = core.parseRateLines($('rates').value);
    var partial = {};
    FIELDS.forEach(function (id) {
      var input = $(id);
      partial[id] = input.type === 'checkbox' ? input.checked : input.value;
    });
    partial.rates = parsed.rates;
    return { config: core.normalizeConfig(partial), errors: parsed.errors };
  }

  /* ---- reading the appointment -------------------------------------- */

  function toAttendee(x, extra) {
    var a = {
      email: x.emailAddress,
      name: x.displayName,
      status: x.appointmentResponse,
      resource: x.recipientType === 'room' || x.recipientType === 'resource'
    };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    if (a.email && a.email.toLowerCase() === state.self) a.self = true;
    return a;
  }

  function getItemData(done) {
    var item = Office.context.mailbox.item;
    var compose = item.requiredAttendees && typeof item.requiredAttendees.getAsync === 'function';

    if (!compose) {
      var list = [];
      if (item.organizer) list.push(toAttendee(item.organizer, { organizer: true }));
      (item.requiredAttendees || []).forEach(function (x) { list.push(toAttendee(x)); });
      (item.optionalAttendees || []).forEach(function (x) { list.push(toAttendee(x, { optional: true })); });
      var rooms = (item.resources || []).map(function (r) { return String(r).toLowerCase(); });
      list.forEach(function (a) { if (a.email && rooms.indexOf(a.email.toLowerCase()) >= 0) a.resource = true; });
      return done({ compose: false, attendees: list, start: item.start, end: item.end, title: item.subject || '' });
    }

    var out = { compose: true, attendees: [], start: null, end: null, title: '' };
    var pending = 0;
    function track(getter, apply) {
      if (!getter || typeof getter.getAsync !== 'function') return;
      pending++;
      getter.getAsync(function (result) {
        if (result.status === Office.AsyncResultStatus.Succeeded) apply(result.value);
        if (--pending === 0) done(out);
      });
    }
    track(item.organizer, function (v) { if (v) out.attendees.unshift(toAttendee(v, { organizer: true })); });
    track(item.requiredAttendees, function (v) { (v || []).forEach(function (x) { out.attendees.push(toAttendee(x)); }); });
    track(item.optionalAttendees, function (v) { (v || []).forEach(function (x) { out.attendees.push(toAttendee(x, { optional: true })); }); });
    track(item.start, function (v) { out.start = v; });
    track(item.end, function (v) { out.end = v; });
    track(item.subject, function (v) { out.title = v || ''; });
    if (!pending) done(out);
  }

  function refreshItem() {
    getItemData(function (data) {
      state.data = data;
      if (!data.attendees.length && state.self) data.attendees.push({ email: state.self, name: 'You', self: true, organizer: data.compose });
      restartTicker();
    });
  }

  /* ---- rendering ----------------------------------------------------- */

  function restartTicker() {
    if (state.ticker) state.ticker.stop();
    state.ticker = core.createTicker(render, state.config.tickSeconds);
  }

  function render() {
    var data = state.data;
    if (!data) return;
    var computed = core.computeMeeting({
      attendees: data.attendees, start: data.start, end: data.end, config: state.config, now: new Date()
    });
    state.computed = computed;

    $('amount').textContent = computed.headline;
    $('label').textContent = computed.label;
    $('subtitle').textContent = computed.subtitle;
    $('costSection').classList.toggle('live', computed.isRunning);
    $('costSection').classList.toggle('over', computed.phase === 'overrun');

    var note = $('note');
    if (!computed.durationMinutes) {
      note.textContent = data.compose ? 'Set a start and end time to see the total for the whole meeting.' : 'This appointment has no duration; showing the hourly burn rate.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    var list = $('guests');
    list.textContent = '';
    computed.people.forEach(function (p) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      var rate = document.createElement('span');
      rate.className = 'rate';
      var bits = [core.formatMoney(p.hourlyRate, state.config) + ' per hour'];
      if (p.organizer) bits.push('organizer');
      if (p.optional) bits.push('optional');
      if (!p.counted) bits.push('not counted');
      if (p.rateSource === 'default') bits.push('default rate');
      rate.textContent = bits.join(' · ');
      li.appendChild(name);
      li.appendChild(rate);
      list.appendChild(li);
    });
  }

  /* ---- actions ------------------------------------------------------- */

  function sendEmailInstead() {
    if (!state.computed) return;
    var draft = core.buildEmailDraft({ title: state.data.title, computed: state.computed });
    var mailbox = Office.context.mailbox;
    if (typeof mailbox.displayNewMessageForm === 'function') {
      try {
        mailbox.displayNewMessageForm({
          toRecipients: draft.to,
          subject: draft.subject,
          htmlBody: draft.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
        });
        return;
      } catch (err) { /* fall through to the web compose link */ }
    }
    window.open(core.composeUrl.outlook(draft), '_blank', 'noopener');
  }

  function wireUi() {
    $('emailInstead').addEventListener('click', sendEmailInstead);

    $('toggleSettings').addEventListener('click', function () {
      var panel = $('settings');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', String(!panel.hidden));
    });

    $('settingsForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var current = readSettings();
      $('errors').textContent = current.errors.map(function (e) {
        return 'Line ' + e.line + ': ' + e.message;
      }).join('\n');
      if (current.errors.length) return;
      saveConfig(current.config, function (err) {
        $('status').textContent = err ? 'Could not save: ' + err.message : 'Saved';
        setTimeout(function () { $('status').textContent = ''; }, 2500);
        if (err) return;
        state.config = current.config;
        restartTicker();
      });
    });
  }
})();
