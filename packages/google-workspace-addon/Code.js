/**
 * Meeting Cost — Google Workspace add-on for Google Calendar
 *
 * Shows, in the Calendar side panel, what an open event costs: the combined
 * hourly rate of its guests, the total for the scheduled length, each guest's
 * rate, and a "Send an Email Instead" button that opens a Gmail draft.
 *
 * Also runs while an event is being *created* (eventUpdateTrigger), so the
 * organizer sees the burn rate grow as they add people.
 *
 * Requires MeetingCostCore.js in the same project (copied from
 * packages/core by `node scripts/sync-core.js`).
 *
 * Note on "updates every minute": Workspace add-on cards are rendered by
 * Google and cannot run a timer. The card shows the cost as of when it was
 * built and offers a Refresh button; the browser extension and the Outlook
 * add-in in this repo tick live.
 */

var PROP_KEY = 'meetingCostConfig';
var LOGO_URL = 'https://www.gstatic.com/images/icons/material/system/1x/paid_black_48dp.png';

/* ---------------------------------------------------------------------- */
/* Triggers                                                                */
/* ---------------------------------------------------------------------- */

function onHomepage(e) {
  return buildHomeCard_(e);
}

function onEventOpen(e) {
  return buildEventCard_(e);
}

function onRefresh(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildEventCard_(e)))
    .build();
}

/** Universal action ("Set hourly rates" in the add-on menu). */
function onOpenSettings(e) {
  return CardService.newUniversalActionResponseBuilder()
    .displayAddOnCards([buildSettingsCard_(e)])
    .build();
}

/** Same settings card, reached from a button. */
function onSettingsAction(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard_(e)))
    .build();
}

function onSaveSettings(e) {
  var inputs = formInputs_(e);
  var parsed = MeetingCostCore.parseRateLines(inputs.rates || '');
  if (parsed.errors.length) {
    var first = parsed.errors[0];
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('Line ' + first.line + ': ' + first.message))
      .build();
  }
  var cfg = MeetingCostCore.normalizeConfig({
    currency: inputs.currency,
    defaultHourlyRate: inputs.defaultHourlyRate,
    hoursPerYear: inputs.hoursPerYear,
    overheadMultiplier: inputs.overheadMultiplier,
    overrunGraceMinutes: inputs.overrunGraceMinutes,
    includeDeclined: inputs.includeDeclined === 'true',
    includeResources: inputs.includeResources === 'true',
    rates: parsed.rates
  });
  saveConfig_(cfg);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Rates saved'))
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

/* ---------------------------------------------------------------------- */
/* Cards                                                                   */
/* ---------------------------------------------------------------------- */

function buildHomeCard_(e) {
  var cfg = getConfig_();
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText(
      'Open any event and its price tag appears here: the combined hourly rate of ' +
      'everyone invited, the total for the scheduled length, and a one-click ' +
      '"Send an Email Instead".'))
    .addWidget(CardService.newDecoratedText()
      .setTopLabel('Default hourly rate')
      .setText(MeetingCostCore.formatMoney(cfg.defaultHourlyRate, cfg) + ' per person')
      .setBottomLabel(Object.keys(cfg.rates).length + ' rate overrides configured'))
    .addWidget(CardService.newTextButton()
      .setText('Set hourly rates')
      .setOnClickAction(CardService.newAction().setFunctionName('onSettingsAction')));

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Meeting Cost').setImageUrl(LOGO_URL))
    .addSection(section)
    .build();
}

function buildEventCard_(e) {
  var cfg = getConfig_();
  cfg.locale = localeOf_(e);
  var cal = (e && e.calendar) || {};
  var attendees = (cal.attendees || []).map(function (a) {
    return {
      email: a.email,
      name: a.displayName,
      status: a.responseStatus,
      optional: !!a.optional,
      organizer: !!a.organizer,
      self: !!a.self,
      resource: !!a.resource
    };
  });
  var details = fetchEventDetails_(cal.calendarId, cal.id);
  var title = details && details.title ? details.title : 'This event';
  var computed = MeetingCostCore.computeMeeting({
    attendees: attendees,
    start: details && !details.allDay ? details.start : null,
    end: details && !details.allDay ? details.end : null,
    config: cfg
  });

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Meeting Cost').setSubtitle(title).setImageUrl(LOGO_URL));

  var main = CardService.newCardSection();
  if (!attendees.length) {
    main.addWidget(CardService.newTextParagraph().setText(
      'No guests on this event yet. Add people and their combined cost appears here.'));
  } else {
    main.addWidget(CardService.newDecoratedText()
      .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.DOLLAR))
      .setText('<font color="#d93025"><b>' + esc_(computed.headline) + '</b> ' + esc_(computed.label) + '</font>')
      .setBottomLabel(computed.subtitle)
      .setWrapText(true));

    if (!computed.durationMinutes) {
      main.addWidget(CardService.newTextParagraph().setText(
        '<font color="#5f6368">' + (details && details.allDay
          ? 'All-day event: showing the hourly burn rate only.'
          : 'Save the event to see the total for its scheduled length.') + '</font>'));
    }

    var buttons = CardService.newButtonSet();
    var draft = MeetingCostCore.buildEmailDraft({ title: title, computed: computed });
    if (draft.to.length) {
      buttons.addButton(CardService.newTextButton()
        .setText('Send an Email Instead')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#1a73e8')
        .setOpenLink(CardService.newOpenLink()
          .setUrl(MeetingCostCore.composeUrl.gmail(draft))
          .setOpenAs(CardService.OpenAs.FULL_SIZE)));
    }
    buttons.addButton(CardService.newTextButton()
      .setText('Refresh')
      .setOnClickAction(CardService.newAction().setFunctionName('onRefresh')));
    main.addWidget(buttons);
    main.addWidget(CardService.newTextParagraph().setText(
      '<font color="#5f6368">As of ' + esc_(formatTime_(new Date(), e)) + '. Tap Refresh for the latest number.</font>'));
  }
  card.addSection(main);

  if (computed.people.length) {
    var guests = CardService.newCardSection()
      .setHeader('Guests')
      .setCollapsible(computed.people.length > 6)
      .setNumUncollapsibleWidgets(6);
    computed.people.forEach(function (p) {
      var notes = [MeetingCostCore.formatMoney(p.hourlyRate, cfg) + ' per hour'];
      if (p.organizer) notes.push('organizer');
      if (p.optional) notes.push('optional');
      if (!p.counted) notes.push('not counted');
      if (p.rateSource === 'default') notes.push('default rate');
      guests.addWidget(CardService.newDecoratedText()
        .setStartIcon(CardService.newIconImage().setIcon(CardService.Icon.PERSON))
        .setText(esc_(p.name))
        .setBottomLabel(notes.join(' · '))
        .setWrapText(true));
    });
    card.addSection(guests);
  }

  card.setFixedFooter(CardService.newFixedFooter()
    .setPrimaryButton(CardService.newTextButton()
      .setText('Set hourly rates')
      .setOnClickAction(CardService.newAction().setFunctionName('onSettingsAction'))));

  return card.build();
}

function buildSettingsCard_(e) {
  var cfg = getConfig_();
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextInput()
      .setFieldName('defaultHourlyRate').setTitle('Default hourly rate')
      .setValue(String(cfg.defaultHourlyRate))
      .setHint('Used for anyone without a match below'))
    .addWidget(CardService.newTextInput()
      .setFieldName('currency').setTitle('Currency (ISO code)').setValue(cfg.currency))
    .addWidget(CardService.newTextInput()
      .setFieldName('hoursPerYear').setTitle('Hours per year')
      .setValue(String(cfg.hoursPerYear)).setHint('Converts salaries to hourly; 2080 = 40 h x 52 wk'))
    .addWidget(CardService.newTextInput()
      .setFieldName('overheadMultiplier').setTitle('Overhead multiplier')
      .setValue(String(cfg.overheadMultiplier)).setHint('1 = salary only, 1.3 = fully loaded'))
    .addWidget(CardService.newTextInput()
      .setFieldName('overrunGraceMinutes').setTitle('Overrun grace (minutes)')
      .setValue(String(cfg.overrunGraceMinutes)))
    .addWidget(CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName('includeDeclined')
      .addItem('Count guests who declined', 'true', cfg.includeDeclined))
    .addWidget(CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName('includeResources')
      .addItem('Count rooms and other resources', 'true', cfg.includeResources))
    .addWidget(CardService.newTextInput()
      .setFieldName('rates').setTitle('Rates by person or domain')
      .setMultiline(true)
      .setValue(MeetingCostCore.serializeRateLines(cfg.rates))
      .setHint('One per line: email = 144.23/hr, email = 300000/yr, @domain = 95, Full Name = 150/hr'))
    .addWidget(CardService.newTextButton()
      .setText('Save')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(CardService.newAction().setFunctionName('onSaveSettings')));

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Meeting Cost settings').setImageUrl(LOGO_URL))
    .addSection(section)
    .build();
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function getConfig_() {
  var raw = PropertiesService.getUserProperties().getProperty(PROP_KEY);
  var stored = {};
  if (raw) {
    try { stored = JSON.parse(raw); } catch (err) { stored = {}; }
  }
  return MeetingCostCore.normalizeConfig(stored);
}

function saveConfig_(cfg) {
  PropertiesService.getUserProperties().setProperty(PROP_KEY, JSON.stringify(cfg));
}

/** Start/end/title come from the Calendar API; the trigger payload has neither. */
function fetchEventDetails_(calendarId, eventId) {
  if (!calendarId || !eventId) return null;
  try {
    var ev = Calendar.Events.get(calendarId, eventId);
    var allDay = !!(ev.start && ev.start.date);
    var start = ev.start && (ev.start.dateTime || ev.start.date);
    var end = ev.end && (ev.end.dateTime || ev.end.date);
    return {
      title: ev.summary || '',
      allDay: allDay,
      start: start ? new Date(start) : null,
      end: end ? new Date(end) : null
    };
  } catch (err) {
    return null;
  }
}

function formInputs_(e) {
  var out = {};
  var inputs = e && e.commonEventObject && e.commonEventObject.formInputs;
  if (inputs) {
    Object.keys(inputs).forEach(function (key) {
      var s = inputs[key].stringInputs;
      out[key] = s && s.value ? s.value.join('\n') : '';
    });
  } else if (e && e.formInput) {
    Object.keys(e.formInput).forEach(function (key) { out[key] = e.formInput[key]; });
  }
  return out;
}

function localeOf_(e) {
  var locale = e && e.commonEventObject && e.commonEventObject.userLocale;
  return locale ? String(locale).replace('_', '-') : undefined;
}

function formatTime_(date, e) {
  var tz = (e && e.userTimezone && e.userTimezone.id) ||
    (e && e.commonEventObject && e.commonEventObject.timeZone && e.commonEventObject.timeZone.id) ||
    Session.getScriptTimeZone();
  return Utilities.formatDate(date, tz, 'h:mm a');
}

function esc_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
