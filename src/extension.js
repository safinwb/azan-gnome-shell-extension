const Geoclue = imports.gi.Geoclue;
const St = imports.gi.St;
const Main = imports.ui.main;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;
const Util = imports.misc.util;
const PermissionStore = imports.misc.permissionStore;
const ExtensionUtils = imports.misc.extensionUtils;

const Extension = imports.misc.extensionUtils.getCurrentExtension();

const PrayTimes = Extension.imports.PrayTimes;
const HijriCalendarKuwaiti = Extension.imports.HijriCalendarKuwaiti;
const Convenience = Extension.imports.convenience;
const PrefsKeys = Extension.imports.prefs_keys;

const Azan = GObject.registerClass(
class Azan extends PanelMenu.Button {

  _init() {
    super._init(0.5, _('Azan'));

    this.indicatorBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    this.indicatorIcon = new St.Icon({
        style_class: 'azan-panel-icon',
        icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER
    });
    this.indicatorIcon.hide();
    this.indicatorText = new St.Label({text: _("Loading..."), y_align: Clutter.ActorAlign.CENTER});
    this.indicatorBox.add_child(this.indicatorIcon);
    this.indicatorBox.add_child(this.indicatorText);
    this.add_child(this.indicatorBox);

    this._gclueLocationChangedId = 0;
    this._weatherAuthorized = false;

    this._opt_calculationMethod = null;
    this._opt_madhab = null;
    this._opt_latitude = null;
    this._opt_longitude = null;
    this._opt_timezone = null;
    this._opt_timeformat12 = false;
    this._opt_concise_list = null;
    this._opt_hijriDateAdjustment = null;
    this._opt_language = 'english';
    this._opt_showCountdown = true;
    this._opt_notifications = '10and5';
    this._opt_panelPosition = 'center';
    this._testNotificationSeq = 0;
    this._notificationSource = null;
    this._lastNextPrayerId = null;
    this._lastNextPrayerMinutes = 0;
    this._lastTimesStr = null;

    this._settings = Convenience.getSettings();
    this._bindSettings();
    this._loadSettings();

    this._dateFormatFull = _("%A %B %e, %Y");

    this._prayTimes = new PrayTimes.PrayTimes('MWL');

    // Arabic day names
    this._dayNames = new Array("الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت");
    this._dayNamesEnglish = new Array("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday");
    
    // Arabic month names  
    this._monthNames = new Array("محرم", "صفر", "ربيع الأول", "ربيع الآخر",
                                 "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان",
                                 "رمضان", "شوال", "ذو القعدة", "ذو الحجة");
    this._monthNamesEnglish = new Array("Muharram", "Safar", "Rabi'ul Awwal", "Rabi'ul Akhir",
                                 "Jumadal Ula", "Jumadal Akhira", "Rajab", "Sha'ban",
                                 "Ramadhan", "Shawwal", "Dhul Qa'ada", "Dhul Hijja");

    this._timeNames = {
        fajr: 'Fajr',
        sunrise: 'Sunrise',
        dhuhr: 'Dhuhr',
        asr: 'Asr',
        sunset: 'Sunset',
        maghrib: 'Maghrib',
        isha: 'Isha',
        midnight: 'Midnight'
    };

    this._timeNamesArabic = {
        fajr: 'الفجر',
        sunrise: 'الشروق',
        dhuhr: 'الظهر',
        asr: 'العصر',
        sunset: 'الغروب',
        maghrib: 'المغرب',
        isha: 'العشاء',
        midnight: 'منتصف الليل'
    };

    this._timeConciseLevels = {
      fajr: 1,
      sunrise: 0,
      dhuhr: 1,
      asr: 1,
      sunset: -1,
      maghrib: 1,
      isha: 1,
      midnight: 0
    };

    this._prayItems = {};
    this._highlightedPrayerId = null;

    this._dateMenuItem = new PopupMenu.PopupMenuItem(_("TODO"), {
        style_class: 'azan-panel', reactive: false, hover: false, activate: false
    });

    this.menu.addMenuItem(this._dateMenuItem);

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (let prayerId in this._timeNames) {

        let prayerName = this._timeNames[prayerId];

        let prayMenuItem = new PopupMenu.PopupMenuItem(_(prayerName), {
            reactive: true, hover: true, activate: false, style_class: 'azan-prayer-item azan-clickable-item'
        });

        prayMenuItem.label.add_style_class_name('azan-prayer-name');
        prayMenuItem.label.set_x_expand(true);

        // Add icon for each prayer time
        let icon = null;
        let iconPath = this._getPrayerIconPath(prayerId);
        if (iconPath) {
            icon = new St.Icon({
                gicon: Gio.icon_new_for_string(iconPath),
                style_class: 'popup-menu-icon',
                icon_size: 16
            });
        }

        let bin = new St.Bin({x_expand: true, x_align: Clutter.ActorAlign.END});
        bin.add_style_class_name('azan-prayer-time-bin');

        // Inner card that acts as a fixed-width flip card
        let timeCard = new St.BoxLayout({ vertical: false, x_expand: true });
        timeCard.add_style_class_name('azan-time-card');

        let prayLabel = new St.Label({
            style_class: 'azan-prayer-time',
            x_expand: true
        });
        timeCard.add_actor(prayLabel);
        bin.add_actor(timeCard);

        prayMenuItem.actor.add_actor(bin);

        this.menu.addMenuItem(prayMenuItem);

        this._prayItems[prayerId] = { 
            menuItem: prayMenuItem, 
            label: prayLabel, 
            labelWidget: prayMenuItem.label, 
            timeBin: bin, 
            timeCard: timeCard,
            icon: icon,
            showingRemaining: false,
            timeoutId: null,
            originalTime: '',
            remainingTime: '',
            remainingMinutes: 0
        };

        // Handle click without closing popup menu.
        prayMenuItem.actor.connect('button-press-event', () => {
            if (prayerId === this._highlightedPrayerId)
                return Clutter.EVENT_STOP;

            this._togglePrayerItemDisplay(prayerId);
            return Clutter.EVENT_STOP;
        });
    };

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._nextPrayerMenuItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false, can_focus: false, hover: false, activate: false, style_class: 'azan-next-prayer'
    });
    this._nextPrayerSummaryBox = new St.BoxLayout({
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER
    });
    this._nextPrayerSummaryIcon = new St.Icon({
        style_class: 'popup-menu-icon azan-next-prayer-icon',
        icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER
    });
    this._nextPrayerRightSpacer = new St.Widget({
        width: 22,
        x_expand: false
    });
    this._nextPrayerSummaryLabel = new St.Label({
        y_align: Clutter.ActorAlign.CENTER
    });
    this._nextPrayerSummaryBox.add_actor(this._nextPrayerSummaryIcon);
    this._nextPrayerSummaryBox.add_actor(this._nextPrayerSummaryLabel);
    this._nextPrayerSummaryBox.add_actor(this._nextPrayerRightSpacer);
    this._nextPrayerMenuItem.actor.add_actor(this._nextPrayerSummaryBox);
    this.menu.addMenuItem(this._nextPrayerMenuItem);

    this._applyLanguageLayout();
    this._updateLabelPeriodic();
    this._updatePrayerVisibility();
    this._updatePrayerMenuLabels();

    // Always reset to original prayer times when popup closes.
    this.menu.connect('open-state-changed', (menu, isOpen) => {
        if (!isOpen)
            this._resetPrayerItemsDisplay();
    });

    this._permStore = new PermissionStore.PermissionStore((proxy, error) => {
        if (error) {
            log('Failed to connect to permissionStore: ' + error.message);
            return;
        }

        this._permStore.LookupRemote('gnome', 'geolocation', (res, error) => {
            if (error)
                log('Error looking up permission: ' + error.message);

            let [perms, data] = error ? [{}, null] : res;
            let  params = ['gnome', 'geolocation', false, data, perms];
            this._onPermStoreChanged(this._permStore, '', params);
        });
    });
  }
    
  _startGClueService() {
    if (this._gclueStarting)
        return;

    this._gclueStarting = true;

    Geoclue.Simple.new('org.gnome.Shell', Geoclue.AccuracyLevel.EXACT, null,
        (o, res) => {
            try {
                this._gclueService = Geoclue.Simple.new_finish(res);
            } catch(e) {
                log('Failed to connect to Geoclue2 service: ' + e.message);
                return;
            }
            this._gclueStarted = true;
            this._gclueService.get_client().distance_threshold = 100;
            this._updateLocationMonitoring();
        });
  }
  
  _onPermStoreChanged(proxy, sender, params) {
    let [table, id, deleted, data, perms] = params;

    if (table != 'gnome' || id != 'geolocation')
        return;

    let permission = perms['org.gnome.Weather.Application'] || ['NONE'];
    let [accuracy] = permission;
    this._weatherAuthorized = accuracy != 'NONE';

    this._updateAutoLocation();
  }
  
  _onGClueLocationChanged() {
      let geoLocation = this._gclueService.location;
      this._opt_latitude = geoLocation.latitude;
      this._opt_longitude = geoLocation.longitude;
      this._settings.set_double(PrefsKeys.LATITUDE, this._opt_latitude);
      this._settings.set_double(PrefsKeys.LONGITUDE, this._opt_longitude);
  }
  
  _updateLocationMonitoring() {
    if (this._opt_autoLocation) {
        if (this._gclueLocationChangedId != 0 || this._gclueService == null)
            return;

        this._gclueLocationChangedId =
            this._gclueService.connect('notify::location',
                                       this._onGClueLocationChanged.bind(this));
        this._onGClueLocationChanged();
    } else {
        if (this._gclueLocationChangedId)
            this._gclueService.disconnect(this._gclueLocationChangedId);
        this._gclueLocationChangedId = 0;
    }
  }
  
  _updateAutoLocation() {
        this._updateLocationMonitoring();

        if (this._opt_autoLocation) {
          this._startGClueService();
        }
  }
  
  _loadSettings() {
    this._opt_calculationMethod = this._settings.get_string(PrefsKeys.CALCULATION_METHOD);
    this._opt_madhab = this._settings.get_string(PrefsKeys.MADHAB);
    this._opt_autoLocation = this._settings.get_boolean(PrefsKeys.AUTO_LOCATION);
    this._updateAutoLocation();
    this._opt_latitude = this._settings.get_double(PrefsKeys.LATITUDE);
    this._opt_longitude = this._settings.get_double(PrefsKeys.LONGITUDE);
    this._opt_timeformat12 = this._settings.get_boolean(PrefsKeys.TIME_FORMAT_12);
    this._opt_timezone = this._settings.get_string(PrefsKeys.TIMEZONE);
    this._opt_concise_list = this._settings.get_string(PrefsKeys.CONCISE_LIST);
    this._opt_hijriDateAdjustment = this._settings.get_double(PrefsKeys.HIJRI_DATE_ADJUSTMENT);
    this._opt_language = this._settings.get_string(PrefsKeys.LANGUAGE);
    this._opt_showCountdown = this._settings.get_boolean(PrefsKeys.SHOW_COUNTDOWN);
    this._opt_notifications = this._settings.get_string(PrefsKeys.NOTIFICATIONS);
    this._opt_panelPosition = this._settings.get_string(PrefsKeys.PANEL_POSITION);
    this._testNotificationSeq = this._settings.get_int(PrefsKeys.TEST_NOTIFICATION_SEQ);
  }  
  _bindSettings() {
    this._settings.connect('changed::' + PrefsKeys.AUTO_LOCATION, (settings, key) => {
        this._opt_autoLocation = settings.get_boolean(key);
        this._updateAutoLocation();
        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.CALCULATION_METHOD, (settings, key) => {
        this._opt_calculationMethod = settings.get_string(key);

        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.MADHAB, (settings, key) => {
        this._opt_madhab = settings.get_string(key);

        this._updateLabel();
    });
    
    this._settings.connect('changed::' + PrefsKeys.LATITUDE, (settings, key) => {
        this._opt_latitude = settings.get_double(key);

        this._updateLabel();
    });
    this._settings.connect('changed::' + PrefsKeys.LONGITUDE, (settings, key) => {
        this._opt_longitude = settings.get_double(key);

        this._updateLabel();
    });
    this._settings.connect('changed::' + PrefsKeys.TIME_FORMAT_12, (settings, key) => {
        this._opt_timeformat12 = settings.get_boolean(key);
        this._updateLabel();
    });
    this._settings.connect('changed::' + PrefsKeys.TIMEZONE, (settings, key) => {
        this._opt_timezone = settings.get_string(key);

        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.CONCISE_LIST, (settings, key) => {
      this._opt_concise_list = settings.get_string(key);
      this._updateLabel();
      this._updatePrayerVisibility();
    });

    this._settings.connect('changed::' + PrefsKeys.HIJRI_DATE_ADJUSTMENT, (settings, key) => {
        this._opt_hijriDateAdjustment = settings.get_double(key);

        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.LANGUAGE, (settings, key) => {
        this._opt_language = settings.get_string(key);
                this._applyLanguageLayout();
        this._updatePrayerMenuLabels();
        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.SHOW_COUNTDOWN, (settings, key) => {
        this._opt_showCountdown = settings.get_boolean(key);
        this._updateLabel();
    });

    this._settings.connect('changed::' + PrefsKeys.NOTIFICATIONS, (settings, key) => {
        this._opt_notifications = settings.get_string(key);
    });

    this._settings.connect('changed::' + PrefsKeys.TEST_NOTIFICATION_SEQ, (settings, key) => {
        let seq = settings.get_int(key);
        if (seq === this._testNotificationSeq)
            return;

        this._testNotificationSeq = seq;
        this._triggerTestNotification();
    });

    this._settings.connect('changed::' + PrefsKeys.PANEL_POSITION, (settings, key) => {
        this._opt_panelPosition = settings.get_string(key);
        this._moveInPanel();
    });
  }

    _isArabic() {
        return this._opt_language === 'arabic';
    }

    _applyLanguageLayout() {
        let rtl = this._isArabic();
        let directionStyle = rtl ? 'direction: rtl;' : 'direction: ltr;';

        if (rtl) {
            // Keep Hijri date centered in Arabic mode.
            this._dateMenuItem.actor.set_style(directionStyle + ' text-align: center;');
            this._dateMenuItem.label.set_x_expand(true);
            this._dateMenuItem.label.set_x_align(Clutter.ActorAlign.CENTER);
            this._dateMenuItem.label.set_style('text-align: center;');
        } else {
            this._dateMenuItem.actor.set_style(directionStyle);
            this._dateMenuItem.label.set_x_expand(false);
            this._dateMenuItem.label.set_x_align(Clutter.ActorAlign.START);
            this._dateMenuItem.label.set_style('');
        }

        this._nextPrayerMenuItem.actor.set_style('direction: ltr;');
        this._nextPrayerSummaryBox.x_align = Clutter.ActorAlign.CENTER;
        this._nextPrayerSummaryLabel.set_style('text-align: center;');

        for (let prayerId in this._prayItems) {
            let prayerItem = this._prayItems[prayerId];
            // Keep row layout logic consistent with LTR and swap actor order for RTL.
            prayerItem.menuItem.actor.set_style('direction: ltr;');

            // Swap columns: In Arabic, time comes first (left), then name (right)
            // In English, name comes first (left), then time (right)
            let container = prayerItem.menuItem.actor;
            
            // Remove all actors
            container.remove_actor(prayerItem.labelWidget);
            container.remove_actor(prayerItem.timeBin);
            if (prayerItem.icon) {
                container.remove_actor(prayerItem.icon);
            }
            
            if (rtl) {
                // Arabic: time then text, with icon to the right of text.
                container.add_actor(prayerItem.timeBin);
                container.add_actor(prayerItem.labelWidget);
                if (prayerItem.icon) {
                    container.add_actor(prayerItem.icon);
                    prayerItem.icon.set_style('margin-left: 6px; margin-right: 0px;');
                }
                // Keep Arabic column widths aligned with the compact English popup width.
                prayerItem.timeBin.set_style('margin-right: 1px; margin-left: 0px; min-width: 84px; max-width: 84px;');
                prayerItem.label.set_style('min-width: 84px; text-align: left;');
            } else {
                // English: icon then text then time.
                if (prayerItem.icon) {
                    container.add_actor(prayerItem.icon);
                    prayerItem.icon.set_style('margin-right: 8px;');
                }
                container.add_actor(prayerItem.labelWidget);
                container.add_actor(prayerItem.timeBin);
                prayerItem.timeBin.set_style('margin-left: 1px; margin-right: 0px; min-width: 84px;');
                prayerItem.label.set_style('min-width: 84px; text-align: right;');
            }
            
            prayerItem.labelWidget.set_style(rtl ? 'text-align: right;' : 'text-align: left;');
            prayerItem.labelWidget.x_align = rtl ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
            prayerItem.label.x_align = rtl ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
            prayerItem.timeBin.x_align = rtl ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
            prayerItem.timeBin.x_expand = !rtl;
        }
    }

  _updatePrayerVisibility() {
    for (let prayerId in this._timeNames) {
      this._prayItems[prayerId].menuItem.actor.visible = this._isVisiblePrayer(prayerId);
    }
  }

  _updatePrayerMenuLabels() {
    for (let prayerId in this._timeNames) {
      let prayerName = this._getPrayerName(prayerId);
      this._prayItems[prayerId].labelWidget.text = prayerName;
    }
  }

  _isVisiblePrayer(prayerId) {
    return this._timeConciseLevels[prayerId] >= this._opt_concise_list;
  }

  _updateLabelPeriodic() {
      let currentSeconds = new Date().getSeconds();
      if (currentSeconds === 0) {
         this._periodicTimeoutId = Mainloop.timeout_add_seconds(60,
         this._updateLabelPeriodic.bind(this));
      } else {
         this._periodicTimeoutId = Mainloop.timeout_add_seconds(60 - currentSeconds,
         this._updateLabelPeriodic.bind(this));
      }
      
      this._updateLabel();
  }

  _updateLabel() {
      let myLocation = [this._opt_latitude, this._opt_longitude];
      let myTimezone = this._opt_timezone;
      this._prayTimes.setMethod(this._opt_calculationMethod);
      this._prayTimes.adjust({asr: this._opt_madhab});

      let currentDate = new Date();

      let currentSeconds = this._calculateSecondsFromDate(currentDate);

      let timesStr;

      if (this._opt_timeformat12) {
        timesStr = this._prayTimes.getTimes(currentDate, myLocation, myTimezone, 'auto', '12h');
      } else {
        timesStr = this._prayTimes.getTimes(currentDate, myLocation, myTimezone, 'auto', '24h');
      }

      let timesFloat = this._prayTimes.getTimes(currentDate, myLocation, myTimezone, 'auto', 'Float');

      let nearestPrayerId;
      let minDiffMinutes = Number.MAX_VALUE;
      let isTimeForPraying = false;
      let remainingTimesForAll = {};
      
      for (let prayerId in this._timeNames) {

          let prayerTime = timesStr[prayerId];
          let prayerItem = this._prayItems[prayerId];

          prayerItem.originalTime = this._formatDisplayedTime(prayerTime);
          if (!prayerItem.showingRemaining)
              prayerItem.label.text = prayerItem.originalTime;

          // Calculate remaining time for ALL prayers (for hover animation)
          let prayerSeconds = this._calculateSecondsFromHour(timesFloat[prayerId]);
          let diffSeconds = prayerSeconds - currentSeconds;

          if (prayerId === 'fajr' && currentSeconds > this._calculateSecondsFromHour(timesFloat['isha'])) {
              prayerSeconds = this._calculateSecondsFromHour(timesFloat['fajr']) + (24 * 60 * 60);
              diffSeconds = prayerSeconds - currentSeconds;
          }

          // For passed events, show remaining time until tomorrow's same event.
          if (diffSeconds <= 0)
              diffSeconds += 24 * 60 * 60;

          let diffMinutes = ~~(diffSeconds / 60);
          remainingTimesForAll[prayerId] = diffMinutes;

          // Store remaining time for click-to-show feature
          prayerItem.remainingMinutes = remainingTimesForAll[prayerId];
          prayerItem.remainingTime = this._formatRemainingTimeFromMinutes(remainingTimesForAll[prayerId]);

          if (prayerItem.showingRemaining) {
              prayerItem.label.text = this._formatRemainingTimeLabel(prayerItem.remainingTime);
              this._applyRemainingTimeTextLayout(prayerItem);
              this._applyRemainingTimeColor(prayerItem);
          }

          if (this._isPrayerTime(prayerId)) {

              let prayerSeconds = this._calculateSecondsFromHour(timesFloat[prayerId]);

              let ishaSeconds = this._calculateSecondsFromHour(timesFloat['isha']);
              let fajrSeconds = this._calculateSecondsFromHour(timesFloat['fajr']);

              if (prayerId === 'fajr' && currentSeconds > ishaSeconds) {
                  prayerSeconds = fajrSeconds + (24 * 60 *60);
              }

              let diffSeconds = prayerSeconds - currentSeconds;

              if (diffSeconds <= 0 && diffSeconds > -60) {
                isTimeForPraying = true;
                nearestPrayerId = prayerId;
                break;
              }

              if (diffSeconds > 0) {
                  let diffMinutes = ~~(diffSeconds / 60);

                  if (diffMinutes <= minDiffMinutes) {
                      minDiffMinutes = diffMinutes;
                      nearestPrayerId = prayerId;
                  }
              }

          }
      };

      if (!nearestPrayerId)
          nearestPrayerId = 'fajr';
      if (minDiffMinutes === Number.MAX_VALUE)
          minDiffMinutes = 0;

      // Highlight the prayer one before the next prayer
      const prayerOrder = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
      let highlightedPrayerId = nearestPrayerId;
      let nextIndex = prayerOrder.indexOf(nearestPrayerId);
      if (nextIndex > 0) {
          highlightedPrayerId = prayerOrder[nextIndex - 1];
      } else if (nextIndex === 0) {
          // If next prayer is Fajr, highlight Isha (wrap around)
          highlightedPrayerId = prayerOrder[prayerOrder.length - 1];
      }

      let currentPrayerHighlightClass;
      if (highlightedPrayerId === 'fajr') {
          // For Fajr, the prayer ends at sunrise — use remaining time until sunrise
          let sunriseSeconds = this._calculateSecondsFromHour(timesFloat['sunrise']);
          // After sunrise and before Dhuhr, Fajr should no longer appear active (grey).
          if (nearestPrayerId === 'dhuhr' && currentSeconds >= sunriseSeconds) {
              currentPrayerHighlightClass = 'azan-current-prayer-grey';
          } else {
              let sunriseDiffSeconds = sunriseSeconds - currentSeconds;
              if (sunriseDiffSeconds <= 0) sunriseDiffSeconds += 24 * 60 * 60;
              let sunriseDiffMinutes = ~~(sunriseDiffSeconds / 60);
              currentPrayerHighlightClass = sunriseDiffMinutes <= 30
                  ? 'azan-current-prayer-red'
                  : 'azan-current-prayer-green';
          }
      } else {
          currentPrayerHighlightClass = minDiffMinutes < 30
              ? 'azan-current-prayer-red'
              : 'azan-current-prayer-green';
      }

      this._highlightedPrayerId = highlightedPrayerId;

      for (let prayerId in this._prayItems) {
          if (prayerId === highlightedPrayerId) {
              this._prayItems[prayerId].menuItem.actor.style_class = 'azan-prayer-item ' + currentPrayerHighlightClass;
          } else {
              this._prayItems[prayerId].menuItem.actor.style_class = 'azan-prayer-item azan-clickable-item';
          }
      }


      let hijriDate = HijriCalendarKuwaiti.KuwaitiCalendar(this._opt_hijriDateAdjustment);

      let outputIslamicDate = this._formatHijriDate(hijriDate);
      
      this._dateMenuItem.label.text = outputIslamicDate;

      this._setNextPrayerSummary(nearestPrayerId, this._getNextPrayerMenuText(nearestPrayerId, minDiffMinutes));
      
      if ((minDiffMinutes === 10) || (minDiffMinutes === 5)) {
          this._notifyReminder(nearestPrayerId, minDiffMinutes, timesStr);
      }

      let panelText = this._getPrayerName(nearestPrayerId) + ' ' + this._formatDisplayedTime(timesStr[nearestPrayerId]);
      if (this._opt_showCountdown) {
          panelText += ' - ' + (this._isArabic() ? 'متبقي ' : 'in ') + this._formatRemainingTimeFromMinutes(minDiffMinutes);
      }
      this._setPanelIndicator(nearestPrayerId, panelText);

      this._lastNextPrayerId = nearestPrayerId;
      this._lastNextPrayerMinutes = minDiffMinutes;
      this._lastTimesStr = timesStr;
  }

  _getNextPrayerMenuText(prayerId, minDiffMinutes) {
      if (this._isArabic())
          return this._getPrayerName(prayerId) + ' خلال ' + this._formatDurationInWords(minDiffMinutes);

      return this._getPrayerName(prayerId) + ' in ' + this._formatDurationInWords(minDiffMinutes);
  }

  _setNextPrayerSummary(prayerId, text) {
      this._nextPrayerSummaryLabel.text = text;

      let iconPath = this._getPrayerIconPath(prayerId);
      if (!iconPath) {
          this._nextPrayerSummaryIcon.hide();
          this._nextPrayerRightSpacer.width = 0;
          return;
      }

      this._nextPrayerSummaryIcon.gicon = Gio.icon_new_for_string(iconPath);
      this._nextPrayerSummaryIcon.show();
      this._nextPrayerRightSpacer.width = 22;
  }

  _formatDurationInWords(diffMinutes) {
      if (this._isArabic())
          return this._formatRemainingTimeFromMinutes(diffMinutes);

      if (diffMinutes < 60)
          return diffMinutes + (diffMinutes === 1 ? ' minute' : ' minutes');

      let hours = ~~(diffMinutes / 60);
      let minutes = ~~(diffMinutes % 60);
      if (minutes === 0)
          return hours + (hours === 1 ? ' hour' : ' hours');

      return hours + (hours === 1 ? ' hour ' : ' hours ') + minutes + (minutes === 1 ? ' minute' : ' minutes');
  }

  _notifyReminder(prayerId, minDiffMinutes, timesStr) {
      if (!this._shouldNotifyAt(minDiffMinutes))
          return;

      let prayerName = this._getPrayerName(prayerId);
      let prayerTimeText = this._formatDisplayedTime(timesStr[prayerId]);
      let reminderMsg = this._isArabic()
          ? minDiffMinutes + " دقيقة متبقية حتى صلاة " + prayerName
          : minDiffMinutes + " minutes remaining until " + prayerName + " prayer.";
      this._showSystemNotification(prayerId, reminderMsg, _("Prayer time : " + prayerTimeText));
  }

  _shouldNotifyAt(minDiffMinutes) {
      if (this._opt_notifications === 'none')
          return false;
      if (this._opt_notifications === '10and5')
          return minDiffMinutes === 10 || minDiffMinutes === 5;
      if (this._opt_notifications === '10')
          return minDiffMinutes === 10;
      if (this._opt_notifications === '5')
          return minDiffMinutes === 5;
      return false;
  }

  _triggerTestNotification() {
      let prayerId = this._lastNextPrayerId || 'maghrib';
      let minutes = this._lastNextPrayerMinutes || 10;
      let timesStr = this._lastTimesStr || {};

      let title = this._getNextPrayerMenuText(prayerId, minutes);
      let fallbackPrayerTime = '';
      if (this._prayItems[prayerId] && this._prayItems[prayerId].originalTime)
          fallbackPrayerTime = this._prayItems[prayerId].originalTime;
      let prayerTimeText = timesStr[prayerId]
          ? this._formatDisplayedTime(timesStr[prayerId])
          : this._formatDisplayedTime(fallbackPrayerTime);
      let subtitle = this._isArabic()
          ? 'وقت الصلاة: ' + prayerTimeText
          : 'Prayer time: ' + prayerTimeText;

      this._showSystemNotification(prayerId, title, subtitle);
  }

  _showSystemNotification(prayerId, title, subtitle) {
      let iconPath = this._getPrayerIconPath(prayerId);
      let gicon = iconPath ? Gio.icon_new_for_string(iconPath) : null;

      try {
          if (!this._notificationSource) {
              this._notificationSource = new MessageTray.Source(_('Azan'), 'dialog-information-symbolic');
              this._notificationSource.connect('destroy', () => {
                  this._notificationSource = null;
              });
              Main.messageTray.add(this._notificationSource);
          }

          let notification;
          try {
              notification = new MessageTray.Notification(this._notificationSource, title, subtitle, gicon ? { gicon } : {});
          } catch (innerError) {
              notification = new MessageTray.Notification(this._notificationSource, title, subtitle);
              if (gicon && notification.set)
                  notification.set({ gicon });
          }

          notification.setTransient(true);
          this._notificationSource.showNotification(notification);
      } catch (e) {
          Main.notify(title, subtitle);
      }
  }

  _clearSystemNotificationSource() {
      if (this._notificationSource) {
          this._notificationSource.destroy();
          this._notificationSource = null;
      }
  }

  getPanelPosition() {
      if (this._opt_panelPosition === 'left')
          return 'left';
      if (this._opt_panelPosition === 'right')
          return 'right';
      return 'center';
  }

  _moveInPanel() {
      if (!this.container)
          return;

      let panelPosition = this.getPanelPosition();
      let targetBox = Main.panel._centerBox;
      if (panelPosition === 'left')
          targetBox = Main.panel._leftBox;
      else if (panelPosition === 'right')
          targetBox = Main.panel._rightBox;
      if (!targetBox)
          return;

      let parent = this.container.get_parent();
      if (!parent || parent === targetBox)
          return;

      if (parent.remove_actor)
          parent.remove_actor(this.container);
      else
          parent.remove_child(this.container);

      let targetIndex = Math.min(1, targetBox.get_n_children());
      if (targetBox.insert_child_at_index)
          targetBox.insert_child_at_index(this.container, targetIndex);
      else
          targetBox.add_actor(this.container);
  }

  _setPanelIndicator(prayerId, text) {
      this.indicatorText.set_text(text);

      let iconPath = this._getPrayerIconPath(prayerId);
      if (!iconPath) {
          this.indicatorIcon.hide();
          return;
      }

      this.indicatorIcon.gicon = Gio.icon_new_for_string(iconPath);
      this.indicatorIcon.show();
  }

  _getPrayerIconPath(prayerId) {
      if (prayerId === 'fajr')
          return Extension.path + '/media/sparkle-symbolic.svg';
      if (prayerId === 'sunrise')
          return Extension.path + '/media/daytime-sunrise-symbolic.svg';
      if (prayerId === 'dhuhr')
          return Extension.path + '/media/sun-symbolic.svg';
      if (prayerId === 'asr')
          return Extension.path + '/media/afternoon-symbolic.svg';
      if (prayerId === 'sunset' || prayerId === 'maghrib')
          return Extension.path + '/media/daytime-sunset-symbolic.svg';
      if (prayerId === 'isha')
          return Extension.path + '/media/moon-symbolic.svg';
      if (prayerId === 'midnight')
          return Extension.path + '/media/moon-stars-symbolic.svg';
      return null;
  }

  _calculateSecondsFromDate(date) {
      return this._calculateSecondsFromHour(date.getHours()) + (date.getMinutes() * 60);
  }

  _calculateSecondsFromHour(hour) {
      return (hour * 60 * 60);
  }

  _isPrayerTime(prayerId) {
      return prayerId === 'fajr' || prayerId === 'dhuhr' || prayerId === 'asr' || prayerId === 'maghrib' || prayerId === 'isha';
  }

  _formatRemainingTimeFromMinutes(diffMinutes) {
      let hours = ~~(diffMinutes / 60);
      let minutes = ~~(diffMinutes % 60);

      let hoursStr = (hours < 10 ? "0" : "") + hours;
      let minutesStr = (minutes < 10 ? "0" : "") + minutes;

      return hoursStr + ":" + minutesStr;
	}

    	_formatHijriDate(hijriDate) {
        if (this._isArabic()) {
          return this._dayNames[hijriDate[4]] + "، " + hijriDate[5] + " " + this._monthNames[hijriDate[6]] + " " + hijriDate[7];
        }

        return this._dayNamesEnglish[hijriDate[4]] + ", " + hijriDate[5] + " " + this._monthNamesEnglish[hijriDate[6]] + " " + hijriDate[7] + " AH";
  	}
  
    _getPrayerName(prayerId) {
        // Check if it's Friday and the prayer is Dhuhr
        let today = new Date();
        let isFriday = today.getDay() === 5;
        
        if (isFriday && prayerId === 'dhuhr') {
            if (this._opt_language === 'arabic') {
                return 'الجمعة';
            }
            return 'Jummah';
        }
        
        if (this._opt_language === 'arabic') {
            return this._timeNamesArabic[prayerId];
        }
        return this._timeNames[prayerId];
    }

    _formatDisplayedTime(timeText) {
        if (!this._isArabic())
            return timeText;

        return timeText
            .replace(/\bAM\b/gi, 'ص')
            .replace(/\bPM\b/gi, 'م');
    }

    _togglePrayerItemDisplay(prayerId) {
        let prayerItem = this._prayItems[prayerId];
        
        // Clear any existing timeout
        if (prayerItem.timeoutId) {
            Mainloop.source_remove(prayerItem.timeoutId);
            prayerItem.timeoutId = null;
        }

        if (prayerItem.showingRemaining) {
            prayerItem.label.text = prayerItem.originalTime;
            this._restorePrayerTimeTextLayout(prayerItem);
            this._clearRemainingTimeStyle(prayerItem);
            prayerItem.showingRemaining = false;
        } else {
            prayerItem.label.text = this._formatRemainingTimeLabel(prayerItem.remainingTime);
            this._applyRemainingTimeTextLayout(prayerItem);
            this._applyRemainingTimeColor(prayerItem);
            prayerItem.showingRemaining = true;
            
            // Auto-revert after 5 seconds
            prayerItem.timeoutId = Mainloop.timeout_add_seconds(5, () => {
                prayerItem.label.text = prayerItem.originalTime;
                this._restorePrayerTimeTextLayout(prayerItem);
                this._clearRemainingTimeStyle(prayerItem);
                prayerItem.showingRemaining = false;
                prayerItem.timeoutId = null;
                return false;
            });
        }
    }

    _applyRemainingTimeTextLayout(prayerItem) {
        prayerItem.label.set_style('min-width: 84px; text-align: center;');
        prayerItem.label.x_align = Clutter.ActorAlign.CENTER;

        if (this._isArabic())
            prayerItem.timeBin.set_style('margin-right: 1px; margin-left: 0px; min-width: 84px; max-width: 84px;');
        else
            prayerItem.timeBin.set_style('margin-left: 1px; margin-right: 0px; min-width: 84px; max-width: 84px;');

        prayerItem.timeBin.x_expand = false;
    }

    _restorePrayerTimeTextLayout(prayerItem) {
        if (this._isArabic()) {
            prayerItem.label.set_style('min-width: 84px; text-align: left;');
            prayerItem.label.x_align = Clutter.ActorAlign.START;
            prayerItem.timeBin.set_style('margin-right: 1px; margin-left: 0px; min-width: 84px; max-width: 84px;');
            prayerItem.timeBin.x_expand = false;
            return;
        }

        prayerItem.label.set_style('min-width: 84px; text-align: right;');
        prayerItem.label.x_align = Clutter.ActorAlign.END;
        prayerItem.timeBin.set_style('margin-left: 1px; margin-right: 0px; min-width: 84px;');
        prayerItem.timeBin.x_expand = true;
    }

    _formatRemainingTimeLabel(remainingTime) {
        // Arabic: word then time. English: prefix word then time.
        if (this._isArabic())
            return 'متبقي\u202F' + remainingTime;
        return 'In ' + remainingTime;
    }

    _clearRemainingTimeStyle(prayerItem) {
        prayerItem.label.remove_style_class_name('azan-remaining-time-green');
        prayerItem.label.remove_style_class_name('azan-remaining-time-red');
        prayerItem.timeCard.remove_style_class_name('azan-time-card-remaining-green');
        prayerItem.timeCard.remove_style_class_name('azan-time-card-remaining-red');
    }

    _applyRemainingTimeColor(prayerItem) {
        this._clearRemainingTimeStyle(prayerItem);

        if (prayerItem.remainingMinutes < 30) {
            prayerItem.label.add_style_class_name('azan-remaining-time-red');
            prayerItem.timeCard.add_style_class_name('azan-time-card-remaining-red');
        } else {
            prayerItem.label.add_style_class_name('azan-remaining-time-green');
            prayerItem.timeCard.add_style_class_name('azan-time-card-remaining-green');
        }
    }

    _resetPrayerItemsDisplay() {
        for (let prayerId in this._prayItems) {
            let prayerItem = this._prayItems[prayerId];

            if (prayerItem.timeoutId) {
                Mainloop.source_remove(prayerItem.timeoutId);
                prayerItem.timeoutId = null;
            }

            prayerItem.showingRemaining = false;
            prayerItem.label.text = prayerItem.originalTime;
            this._restorePrayerTimeTextLayout(prayerItem);
            this._clearRemainingTimeStyle(prayerItem);
        }
    }
  
    stop() {

    	this.menu.removeAll();

        // Clean up all prayer item click timeouts
        for (let prayerId in this._prayItems) {
            if (this._prayItems[prayerId].timeoutId) {
                Mainloop.source_remove(this._prayItems[prayerId].timeoutId);
                this._prayItems[prayerId].timeoutId = null;
            }
        }

        this._clearSystemNotificationSource();

		if (this._periodicTimeoutId) {
        Mainloop.source_remove(this._periodicTimeoutId);
  		}
		}
});

let azan;

function init() {
}

function enable() {
  azan = new Azan();
  Main.panel.addToStatusArea('azan', azan, 1, azan.getPanelPosition());
}

function disable() {
	azan.stop();
  azan.destroy();
}
