/**
 * TrailReady 步履无忧 — 主页逻辑
 * 完整移植自 Web 版：多日路线 + 日期联动 + 装备库 CRUD + 天气模拟 + 打包推荐
 */
var dateUtils = require('../../utils/dateUtils');
var mockData = require('../../utils/mockData');
var weatherApi = require('../../utils/weatherApi');
const { assistantAvailable } = require('../../utils/trailAssistant');
var recommendation = require('../../utils/recommendation');
var trips = require('../../utils/trips');

const dayMetrics = [
  { key: 'distance', label: '计划里程', unit: 'km' },
  { key: 'ascent', label: '累计爬升', unit: 'm' },
  { key: 'hours', label: '计划用时', unit: '小时' }
];

Page({

  /* ──────────── 常量（注入 data） ──────────── */
  WEATHER_PRESET_OPTIONS: [
    { key: '', label: '天气待核实' },
    { key: 'clear_warm',    label: '晴朗温暖' },
    { key: 'clear_cool',    label: '晴朗凉爽' },
    { key: 'wind_cold',     label: '大风降温' },
    { key: 'rain_moderate', label: '中雨' },
    { key: 'rain_heavy',    label: '大雨/暴风' },
    { key: 'snow',          label: '降雪/严寒' }
  ],

  GEAR_CATEGORY_OPTIONS: [
    { value: 'clothing',    label: '衣物层' },
    { value: 'sleeping',    label: '睡眠系统' },
    { value: 'cooking',     label: '炊具水具' },
    { value: 'electronics', label: '电子/导航' },
    { value: 'misc',        label: '其他' }
  ],

  ALL_TAGS: [
    '防风','防水','冲锋衣','硬壳','速干',
    '重保暖','轻保暖','羽绒','内衣','袜子',
    '基础层','徒步','露营','炊事','饮水',
    '导航','照明','急救','防晒','防雨',
    '燃料','路粮','旅行'
  ],

  data: {
    /* Tab */
    activeTab: 'trip',

    /* Theme */
    currentTheme: 'nature',

    /* Trip */
    startDate: '',
    totalDays: 3,
    dayPlans: [],
    dayMetrics,
    tripDateRange: '',
    dateExceedsForecast: false,
    canQueryWeather: false,
    weatherLoadingIndex: -1,
    suggestions: {},
    suggestionsLoadingIndex: -1,
    destinationChain: '',
    smartLodgeHint: '',

    /* Gear */
    gear: [],
    gearGrouped: [],
    gearCount: 0,
    gearWeight: 0,
    expandedCategories: {},

    /* 装备表单 */
    directGearEdit: false,
    editingId: '',
    formName: '',
    formCategoryIndex: 0,
    formCategoryLabel: '衣物层',
    formWeight: '',
    formTags: [],
    tagsOpen: false,
    formError: '',

    /* Packing */
    packedItems: {},
    result: null,
    totalWeightDisplay: '0 g',
    packingGrouped: [],
    packedCount: 0,
    packedWeight: 0,
    packedPercent: 0,
    expandedPackCategories: {}
  },

  /* ================================================================ */
  /*  辅助函数（绑定在 Page 实例上）                                    */
  /* ================================================================ */

  /** 根据 startDate + totalDays 构建 dayPlan 数组 */
  _buildDayPlans: function (startDate, totalDays, existingPlans) {
    var plans = [];
    for (var i = 0; i < totalDays; i++) {
      var fd = dateUtils.formatDayDate(startDate, i);
      var old = (existingPlans && existingPlans[i]) || null;

      const sameDate = old && old.dateString === fd.dateString;
      plans.push({
        ...old,
        dayIndex: i + 1,
        destination: old ? old.destination : '',
        weatherPreset: sameDate ? old.weatherPreset : '',
        weatherPresetIndex: sameDate ? old.weatherPresetIndex : 0,
        dateString: fd.dateString,
        weekday: fd.weekday,
        displayDate: fd.displayDate,
        stayType: (old && old.stayType) || (this.tripId ? 'daytrip' : 'camping'),
        stayConfirmed: !!(sameDate && old.stayConfirmed),
        transportConfirmed: !!(sameDate && old.transportConfirmed),
        fetchedWeather: sameDate && old.fetchedWeather?.source === 'qweather' ? old.fetchedWeather : null
      });
    }
    return plans;
  },

  /** 将装备按分类分组（返回数组，wx:for 可用） */
  _buildGearGrouped: function (gear, expandedMap) {
    var map = {};
    mockData.CATEGORY_ORDER.forEach(function (cat) { map[cat] = []; });

    gear.forEach(function (item) {
      if (map[item.category]) {
        map[item.category].push(item);
      }
    });

    return mockData.CATEGORY_ORDER
      .filter(function (cat) { return map[cat].length > 0; })
      .map(function (cat) {
        var items = map[cat];
        var totalWeight = items.reduce(function (s, it) { return s + it.weight; }, 0);
        return {
          category: cat,
          label: mockData.CATEGORY_LABELS[cat] || cat,
          items: items,
          totalWeight: totalWeight,
          expanded: expandedMap[cat] !== false // 默认展开
        };
      });
  },

  /** 将打包清单按分类分组 */
  _buildPackingGrouped: function (items, expandedMap) {
    var map = {};
    mockData.CATEGORY_ORDER.forEach(function (cat) { map[cat] = []; });

    items.forEach(function (item) {
      if (map[item.category]) {
        map[item.category].push(item);
      }
    });

    return mockData.CATEGORY_ORDER
      .filter(function (cat) { return map[cat].length > 0; })
      .map(function (cat) {
        var catItems = map[cat];
        var catWeight = catItems.reduce(function (s, it) { return s + it.weight * it.quantity; }, 0);
        var packed = catItems.filter(function (it) { return it.packed; }).length;
        return {
          category: cat,
          label: mockData.CATEGORY_LABELS[cat] || cat,
          items: catItems,
          catWeight: catWeight,
          total: catItems.length,
          packed: packed,
          expanded: expandedMap[cat] !== false
        };
      });
  },

  /* ================================================================ */
  /*  生命周期                                                         */
  /* ================================================================ */
  onLoad: function (options = {}) {
    this.tripId = options.trip;
    var trip = this.tripId && trips.read().trips.find(t => t.id === this.tripId);
    var demoGear = !this.tripId && (options.tab !== 'gear' || options.demo === '1');
    var gear = trips.loadGear(demoGear);
    var today = trip ? trip.start : dateUtils.getTodayString();
    var dayPlans = this._buildDayPlans(today, trip ? trip.days.length : 3, trip ? trip.days : null);
    var dateRange = dateUtils.formatDateRange(today, dayPlans.length);

    // ═══ 🎨 读取用户上次选择的主题 ═══
    var savedTheme = 'nature';
    try {
      var stored = wx.getStorageSync('user_theme');
      if (stored === 'dark' || stored === 'nature') {
        savedTheme = stored;
      }
    } catch (e) { /* 读取失败则使用默认 */ }

    this.setData({
      scoped: !!trip || options.tab === 'gear',
      demoGear,
      tripName: trip ? trip.name : '',
      activeTab: options.tab === 'gear' ? 'gear' : 'trip',
      totalDays: dayPlans.length,
      // 注入 WXML 模板需要的常量（来自 Page 顶层属性）
      weatherPresetOptions: this.WEATHER_PRESET_OPTIONS,
      canQueryWeather: assistantAvailable(),
      allTags: this.ALL_TAGS,
      gearCategoryOptions: this.GEAR_CATEGORY_OPTIONS,

      startDate: today,
      dayPlans: dayPlans,
      tripDateRange: dateRange,
      dateExceedsForecast: this._updateForecastWarning(today, dayPlans.length),
      gear: gear,
      gearGrouped: this._buildGearGrouped(gear, {}),
      gearCount: gear.length,
      gearWeight: gear.reduce(function (s, it) { return s + it.weight; }, 0),
      currentTheme: savedTheme
    });

    if (options.tab === 'gear' && options.edit === 'new') {
      this.setData({ directGearEdit: true });
      wx.setNavigationBarTitle({ title: '添加装备' });
    } else if (options.tab === 'gear') {
      const item = gear.find(g => g.id === options.edit);
      if (item) this.editGear(item);
      wx.setNavigationBarTitle({ title: item ? '编辑装备' : '装备库' });
    } else if (trip) {
      wx.setNavigationBarTitle({ title: '编辑行程' });
    } else {
      this._recompute();
    }
  },

  onShow() {
    if (this.data.activeTab === 'gear' && !this.data.directGearEdit) {
      this._updateGearData(trips.loadGear(this.data.demoGear));
      if (!this.tripId) this._recompute();
    }
  },

  onUnload() {
    clearTimeout(this._citySearchTimer);
    this.unloaded = true;
  },

  _savePlan() {
    if (!this.tripId || this.data.activeTab !== 'trip') return;
    const { tripName, startDate, dayPlans } = this.data;
    const saved = trips.update(this.tripId, trip => {
      if (trip.start !== startDate) trip.checks.forEach(c => { c.done = false; });
      trip.name = tripName.trim() || '我的行程';
      trip.start = startDate;
      trip.days = dayPlans.map(day => {
        const savedDay = { ...day };
        for (const { key } of dayMetrics) {
          const value = day[key];
          savedDay[key] = value == null || value === '' || value === '.' ? null : Number(value);
        }
        return savedDay;
      });
    });
    this.setData({ saveFailed: !saved });
  },

  onTripNameInput(e) {
    this.setData({ tripName: e.detail.value });
    this._savePlan();
  },

  _clearMapHours(index, patch) {
    if (this.data.dayPlans[index].hoursSource === 'map') {
      patch['dayPlans[' + index + '].hours'] = null;
      patch['dayPlans[' + index + '].hoursSource'] = null;
    }
  },

  onDayFieldInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const key = 'dayPlans[' + index + '].';
    const patch = { [key + field]: e.detail.value };
    if (field === 'stay' || field === 'transport') patch[key + field + 'Confirmed'] = false;
    if (field === 'hours') patch[key + 'hoursSource'] = /\d/.test(e.detail.value) ? 'manual' : null;
    if (field === 'from') {
      patch[key + 'transportConfirmed'] = false;
      if (e.detail.value !== this.data.dayPlans[index].from) this._clearMapHours(index, patch);
    }
    this.setData(patch);
    this._savePlan();
  },

  onDayMetricInput(e) {
    const { index, field } = e.currentTarget.dataset;
    if (!/^\d*(\.\d*)?$/.test(e.detail.value)) {
      wx.showToast({ title: '请填写非负数', icon: 'none' });
      const previous = this.data.dayPlans[index][field];
      return previous == null ? '' : String(previous);
    }
    this.onDayFieldInput(e);
  },

  finishTripEdit() {
    this._savePlan();
    if (!this.data.saveFailed) wx.navigateBack();
  },

  /* ================================================================ */
  /*  📋 行程 — 日期 & 天数                                            */
  /* ================================================================ */
  onStartDateChange: function (e) {
    var newStart = e.detail.value;

    // ═══ 日期边界校验：出发日不得超过未来 30 天 ═══
    if (!this.tripId && this._checkDateBoundary(newStart)) {
      wx.showToast({
        title: '请选择未来 30 天内的日期',
        icon: 'none',
        duration: 2500
      });
      var today = dateUtils.getTodayString();
      var resetPlans = this._buildDayPlans(today, this.data.totalDays, this.data.dayPlans);
      var resetRange = dateUtils.formatDateRange(today, resetPlans.length);

      this.setData({
        startDate: today,
        dayPlans: resetPlans,
        tripDateRange: resetRange,
        dateExceedsForecast: false
      });
      this._recompute();
      return;
    }

    var dayPlans = this._buildDayPlans(newStart, this.data.totalDays, this.data.dayPlans);
    var dateRange = dateUtils.formatDateRange(newStart, dayPlans.length);
    var isExceeding = this._updateForecastWarning(newStart, this.data.totalDays);

    this.setData({
      startDate: newStart,
      dayPlans: dayPlans,
      tripDateRange: dateRange,
      dateExceedsForecast: isExceeding
    });
    this._recompute();
  },

  onDaysMinus: function () {
    if (this.data.totalDays <= 1) return;
    this._setTotalDays(this.data.totalDays - 1);
  },

  onDaysPlus: function () {
    if (this.data.totalDays >= weatherApi.MAX_FORECAST_DAYS) return;
    this._setTotalDays(this.data.totalDays + 1);
  },

  onDaysInput: function (e) {
    var v = parseInt(e.detail.value);
    if (!isNaN(v)) this._setTotalDays(Math.max(1, v));
  },

  _setTotalDays: function (total) {
    // ═══ 30 天硬边界：超出部分安全降级 ═══
    if (total > weatherApi.MAX_FORECAST_DAYS) {
      total = weatherApi.MAX_FORECAST_DAYS;
      wx.showModal({
        title: '行程最多支持 30 天',
        content: '已将本次行程设为 30 天。',
        showCancel: false,
        confirmText: '好的'
      });
    }

    var dayPlans = this._buildDayPlans(this.data.startDate, total, this.data.dayPlans);
    var dateRange = dateUtils.formatDateRange(this.data.startDate, total);
    var isExceeding = this._updateForecastWarning(this.data.startDate, total);

    this.setData({
      totalDays: total,
      dayPlans: dayPlans,
      tripDateRange: dateRange,
      dateExceedsForecast: isExceeding
    });
    this._recompute();
  },

  /**
   * 严格阻断：出发日期是否超过未来 30 天
   * @returns {boolean}
   */
  _checkDateBoundary: function (startDate) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var maxDate = new Date(today.getTime() + weatherApi.MAX_FORECAST_DAYS * 24 * 60 * 60 * 1000);
    var selected = new Date(startDate + 'T00:00:00');
    return selected > maxDate;
  },

  /**
   * 动态更新预报警告状态：行程中任一天超过未来 30 天即触发
   * @returns {boolean}
   */
  _updateForecastWarning: function (startDate, totalDays) {
    const end = dateUtils.formatDayDate(startDate, totalDays - 1).dateString;
    return !weatherApi.isDateInForecastRange(startDate) || !weatherApi.isDateInForecastRange(end);
  },

  /* ================================================================ */
  /*  📋 行程 — 按天住宿方式                                            */
  /* ================================================================ */
  onStayTypeToggle: function (e) {
    var index = e.currentTarget.dataset.index;
    var type = e.currentTarget.dataset.type;
    var updateData = {};
    updateData['dayPlans[' + index + '].stayType'] = type;
    updateData['dayPlans[' + index + '].stayConfirmed'] = false;
    if (type === 'daytrip') updateData['dayPlans[' + index + '].stay'] = '';
    this.setData(updateData);
    this._recompute();
  },

  /* ================================================================ */
  /*  📋 行程 — 目的地 & 天气                                           */
  /* ================================================================ */

  // 防抖定时器引用（页面级，不参与 setData）
  _citySearchTimer: null,
  _activeCityIndex: -1,
  _dropdownVisibleForMask: false,

  onDestinationInput: function (e) {
    var index = e.currentTarget.dataset.index;
    var value = e.detail.value;
    var key = 'dayPlans[' + index + '].destination';
    var updateData = {};
    if (value !== this.data.dayPlans[index].destination) this._clearMapHours(index, updateData);
    updateData[key] = value;
    // 手动编辑即清除缓存的精准坐标 & ID，后续走文本查询
    updateData['dayPlans[' + index + ']._locationLngLat'] = '';
    updateData['dayPlans[' + index + ']._locationId'] = '';
    updateData['dayPlans[' + index + '].simulatedWeather'] = null;
    updateData['dayPlans[' + index + '].fetchedWeather'] = null;
    updateData['dayPlans[' + index + '].transportConfirmed'] = false;
    updateData['dayPlans[' + index + '].stayConfirmed'] = false;
    this.setData(updateData);
    this._savePlan();

    // 清空输入 → 隐藏联想
    if (!value || !value.trim()) {
      this.setData({
        ['suggestions[' + index + ']']: null,
        suggestionsLoadingIndex: -1
      });
      this._updateMaskVisibility();
      return;
    }

    // 300ms 防抖联想搜索
    this._searchCitiesDebounced(index, value.trim());
  },

  onDestinationFocus: function (e) {
    var index = e.currentTarget.dataset.index;
    this._activeCityIndex = index;
    // 如果当前输入已有关键词且有缓存结果，直接展示
    var day = this.data.dayPlans[index];
    if (day && day.destination && day.destination.trim()) {
      this._searchCitiesDebounced(index, day.destination.trim());
    }
  },

  /** 300ms 防抖联想搜索 */
  _searchCitiesDebounced: function (index, query) {
    var self = this;
    if (this._citySearchTimer) clearTimeout(this._citySearchTimer);

    this._citySearchTimer = setTimeout(function () {
      self.setData({ suggestionsLoadingIndex: index });

      weatherApi.searchCities(query).then(function (cities) {
        // 防止过期响应覆盖新输入
        var currentVal = (self.data.dayPlans[index] || {}).destination || '';
        if (currentVal.trim() !== query) return;

        var updateData = {};
        updateData['suggestions[' + index + ']'] = cities;
        updateData['suggestionsLoadingIndex'] = -1;
        self.setData(updateData);
        self._updateMaskVisibility();
      }).catch(function () {
        self.setData({
          ['suggestions[' + index + ']']: [],
          suggestionsLoadingIndex: -1
        });
        self._updateMaskVisibility();
      });
    }, 300);
  },

  /** 更新透明遮罩可见性：任一天有下拉即展示 */
  _updateMaskVisibility: function () {
    var hasDropdown = false;
    var suggestions = this.data.suggestions;
    if (suggestions) {
      // suggestions 是 sparse array，遍历 dayPlans 索引
      for (var i = 0; i < this.data.dayPlans.length; i++) {
        if (suggestions[i] && suggestions[i].length > 0) {
          hasDropdown = true;
          break;
        }
      }
    }
    if (this._dropdownVisibleForMask !== hasDropdown) {
      this._dropdownVisibleForMask = hasDropdown;
      this.setData({ suggestionMaskVisible: hasDropdown });
    }
  },

  /** 点击遮罩层 → 仅隐藏全部下拉，不触发任何查询 */
  hideAllSuggestions: function () {
    var updateData = { suggestionMaskVisible: false };
    this._dropdownVisibleForMask = false;
    this.data.dayPlans.forEach(function (_, i) {
      updateData['suggestions[' + i + ']'] = null;
    });
    updateData['suggestionsLoadingIndex'] = -1;
    this.setData(updateData);
    this._activeCityIndex = -1;
  },

  /** 点击联想项 — 选中 POI 并触发天气查询（地图经纬度优先） */
  onSelectCity: function (e) {
    var index = e.currentTarget.dataset.dayIndex;
    var city = e.currentTarget.dataset.city;

    if (!city || !city.name) return;

    // 填入 POI 名称 + 存入经纬度（lng,lat 格式给和风天气用）
    var updateData = {};
    updateData['dayPlans[' + index + '].destination'] = city.name;
    const coords = city.lng && city.lat ? city.lng + ',' + city.lat : '';
    const day = this.data.dayPlans[index];
    if (day.destination !== city.name || day._locationLngLat !== coords) this._clearMapHours(index, updateData);
    updateData['dayPlans[' + index + ']._locationLngLat'] = coords;
    // 腾讯地点 ID 与和风 Location ID 属于不同服务，地点查询使用坐标或名称。
    updateData['dayPlans[' + index + ']._locationId'] = '';
    updateData['dayPlans[' + index + '].fetchedWeather'] = null;
    updateData['dayPlans[' + index + '].simulatedWeather'] = null;
    updateData['dayPlans[' + index + '].transportConfirmed'] = false;
    updateData['dayPlans[' + index + '].stayConfirmed'] = false;
    updateData['suggestions[' + index + ']'] = null;
    updateData['suggestionsLoadingIndex'] = -1;
    this.setData(updateData);
    this._updateMaskVisibility();

    // 触发天气查询
    this._savePlan();
    if (this.data.canQueryWeather && weatherApi.isDateInForecastRange(this.data.dayPlans[index].dateString)) {
      this._fetchWeatherForIndex(index, city.name);
    }
  },

  /**
   * ═══════════════════════════════════════
   *  🛡️ 失焦 — 已废除掩藏下拉逻辑
   * ═══════════════════════════════════════
   * 下拉列表的关闭现在由全屏透明遮罩层接管：
   *   点击选项 → catchtap 选中并自动收起
   *   点击其他区域 → 遮罩层捕获并关闭
   * bindblur 已从 input 上移除，此函数仅留作占位，
   * 防止旧代码引用报错，不做任何实际操作。
   */
  onDestinationBlur: function () {
    // 键盘收起时不做任何下拉隐藏操作
  },

  refreshWeather(e) {
    const index = e.currentTarget.dataset.index;
    this.hideAllSuggestions();
    return this._fetchWeatherForIndex(index, this.data.dayPlans[index].destination);
  },

  /** 统一天气查询入口 — 包裹 Loading 提示，优先走地图经纬度通道 */
  _fetchWeatherForIndex: function (index, destination) {
    var self = this;
    var day = this.data.dayPlans[index];
    const requestedDate = day.dateString;
    if (!weatherApi.isDateInForecastRange(requestedDate)) {
      wx.showToast({ title: '该日期超出预报范围', icon: 'none' });
      return;
    }
    var dateStrings = [requestedDate];
    const requestedPreset = day.weatherPreset;
    const stillCurrent = () => {
      const current = this.data.dayPlans[index];
      return !this.unloaded && current && current.destination === destination && current.dateString === requestedDate
        && current.weatherPreset === requestedPreset;
    };

    wx.showLoading({ title: '正在气象站连线...', mask: true });
    this.setData({ weatherLoadingIndex: index });

    // 旧行程可能缓存腾讯的 POI ID。和风查询只传坐标或地名。
    let unavailable = false;
    return weatherApi.fetchTripWeather(destination, dateStrings, day._locationLngLat).catch(() => {
      unavailable = true;
      return {};
    }).then(function (weatherMap) {
      wx.hideLoading();
      if (!self.unloaded) self.setData({ weatherLoadingIndex: -1 });
      if (!stillCurrent()) return;
      const weather = weatherMap[requestedDate] || null;
      if (!weather) {
        wx.showToast({ title: unavailable ? '天气服务暂不可用，可手动填写' : '当天暂无预报，可手动填写', icon: 'none' });
      }
      self.setData({ ['dayPlans[' + index + '].fetchedWeather']: weather });
      self._recompute();
    });
  },

  onWeatherPresetChange: function (e) {
    var index = e.currentTarget.dataset.index;
    var presetIndex = parseInt(e.detail.value);
    var presetKey = this.WEATHER_PRESET_OPTIONS[presetIndex].key;

    var updateData = {};
    updateData['dayPlans[' + index + '].weatherPreset'] = presetKey;
    updateData['dayPlans[' + index + '].weatherPresetIndex'] = presetIndex;
    updateData['dayPlans[' + index + '].simulatedWeather'] = null;
    updateData['dayPlans[' + index + '].fetchedWeather'] = null;
    this.setData(updateData);
    this._recompute();
  },

  /* ================================================================ */
  /*  🎒 装备 — CRUD                                                    */
  /* ================================================================ */
  editGear: function (item) {
    var catOpts = this.GEAR_CATEGORY_OPTIONS;
    var catIndex = 0;
    for (var j = 0; j < catOpts.length; j++) {
      if (catOpts[j].value === item.category) { catIndex = j; break; }
    }

    this.setData({
      directGearEdit: true,
      editingId: item.id,
      formName: item.name,
      formCategoryIndex: catIndex,
      formCategoryLabel: catOpts[catIndex].label,
      formWeight: item.weight == null ? '' : String(item.weight),
      formTags: item.tags && item.tags.slice ? item.tags.slice() : [],
      formError: ''
    });
  },

  cancelGearEdit: function () {
    wx.navigateBack();
  },

  onFormNameInput: function (e) {
    this.setData({ formName: e.detail.value, formError: '' });
  },

  onFormCategoryChange: function (e) {
    var idx = parseInt(e.detail.value);
    var catOpts = this.GEAR_CATEGORY_OPTIONS;
    this.setData({
      formCategoryIndex: idx,
      formCategoryLabel: catOpts[idx].label,
      formError: ''
    });
  },

  onFormWeightInput: function (e) {
    this.setData({ formWeight: e.detail.value, formError: '' });
  },

  toggleTags() { this.setData({ tagsOpen: !this.data.tagsOpen }); },

  onToggleTag: function (e) {
    var tag = e.currentTarget.dataset.tag;
    if (!tag) return;

    var formTags = this.data.formTags || [];
    formTags = formTags.slice();

    var idx = -1;
    for (var i = 0; i < formTags.length; i++) {
      if (formTags[i] === tag) {
        idx = i;
        break;
      }
    }

    if (idx >= 0) {
      // 已选中 → 移除（反选）
      formTags.splice(idx, 1);
    } else {
      // 未选中 → 添加
      formTags.push(tag);
    }

    this.setData({
      formTags: formTags,
      formError: ''
    });
  },

  onSaveGear: function () {
    var name = (this.data.formName || '').trim();
    var weight = this.data.formWeight.trim() ? Number(this.data.formWeight) : null;
    var catOpts = this.GEAR_CATEGORY_OPTIONS;
    var category = catOpts[this.data.formCategoryIndex].value;
    var tags = this.data.formTags;
    // 防御：确保 tags 始终是纯数组
    if (!Array.isArray(tags)) {
      tags = [];
    }

    // 校验
    if (!name) {
      this.setData({ formError: '请输入装备名称' });
      return;
    }
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      this.setData({ formError: '请输入有效的重量（大于 0）' });
      return;
    }

    var gear = this.data.gear.slice();

    if (this.data.editingId) {
      // 编辑
      for (var i = 0; i < gear.length; i++) {
        if (gear[i].id === this.data.editingId) {
          gear[i] = {
            id: gear[i].id,
            name: name,
            weight: weight,
            category: category,
            tags: tags
          };
          break;
        }
      }
    } else {
      // 新增
      gear.push({
        id: String(Date.now()),
        name: name,
        weight: weight,
        category: category,
        tags: tags
      });
    }

    if (!trips.saveGear(gear, this.data.demoGear)) return;
    wx.navigateBack();
  },

  onDeleteGear: function (e) {
    var id = e.currentTarget.dataset.id;
    const using = !this.data.demoGear && trips.read().trips.find(t => t.carry[id]);
    if (using) {
      wx.showModal({ title: '装备正在使用', content: '请先从「' + using.name + '」的本次装备中移除。', showCancel: false });
      return;
    }
    var item = null;
    var gear = this.data.gear;
    for (var i = 0; i < gear.length; i++) {
      if (gear[i].id === id) { item = gear[i]; break; }
    }

    var self = this;
    wx.showModal({
      title: '确认删除',
      content: (item ? item.name : '') + '将从装备库移除。',
      confirmColor: self.data.currentTheme === 'dark' ? '#FF5252' : '#D94F4F',
      success: function (res) {
        if (res.confirm) {
          var newGear = self.data.gear.filter(function (g) { return g.id !== id; });
          if (!trips.saveGear(newGear, self.data.demoGear)) return;
          self._updateGearData(newGear);
          self._recompute();
          if (self.data.directGearEdit) wx.navigateBack();
        }
      }
    });
  },

  /* ================================================================ */
  /*  ✅ 打包 — 交互                                                    */
  /* ================================================================ */
  onTogglePacked: function (e) {
    var id = e.currentTarget.dataset.id;
    var packedItems = Object.assign({}, this.data.packedItems);
    if (packedItems[id]) {
      delete packedItems[id];
    } else {
      packedItems[id] = true;
    }
    this.setData({ packedItems: packedItems });
    this._recompute();
  },

  /* ================================================================ */
  /*  折叠/展开                                                        */
  /* ================================================================ */
  onToggleCategory: function (e) {
    var cat = e.currentTarget.dataset.cat;
    var expanded = Object.assign({}, this.data.expandedCategories);
    expanded[cat] = expanded[cat] === false;
    this.setData({
      expandedCategories: expanded,
      gearGrouped: this._buildGearGrouped(this.data.gear, expanded)
    });
  },

  onTogglePackCategory: function (e) {
    var cat = e.currentTarget.dataset.cat;
    var expanded = Object.assign({}, this.data.expandedPackCategories);
    expanded[cat] = expanded[cat] === false;
    this.setData({
      expandedPackCategories: expanded,
      packingGrouped: this._buildPackingGrouped(
        (this.data.result && this.data.result.items) || [],
        expanded
      )
    });
  },

  /* ================================================================ */
  /*  标签切换                                                        */
  /* ================================================================ */
  switchTab: function (e) {
    var tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    // 切换到打包标签时刷新统计
    if (tab === 'packing') {
      this._updatePackingStats();
    }
    // 切换到装备标签时刷新分组
    if (tab === 'gear') {
      this.setData({
        gearGrouped: this._buildGearGrouped(this.data.gear, this.data.expandedCategories),
        gearCount: this.data.gear.length,
        gearWeight: this.data.gear.reduce(function (s, it) { return s + it.weight; }, 0)
      });
    }
  },

  /* ================================================================ */
  /*  🎨 主题切换                                                      */
  /* ================================================================ */
  onToggleTheme: function () {
    var newTheme = this.data.currentTheme === 'dark' ? 'nature' : 'dark';
    this.setData({ currentTheme: newTheme });
    // 持久化到本地存储，下次打开依然是你喜欢的风格
    try {
      wx.setStorageSync('user_theme', newTheme);
    } catch (e) {
      console.warn('主题偏好保存失败', e);
    }
    // 切换时给予轻柔的触感反馈
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  /* ================================================================ */
  /*  内部方法                                                         */
  /* ================================================================ */

  /** 重新运行推荐引擎 */
  _recompute: function () {
    if (this.tripId) {
      this._savePlan();
      return;
    }
    var tripData = {
      dayPlans: this.data.dayPlans,
      startDate: this.data.startDate
    };

    // 是否有任何目的地
    var hasDest = tripData.dayPlans.some(function (d) { return d.destination && d.destination.trim(); });

    var result = null;
    if (hasDest && this.data.gear.length > 0) {
      result = recommendation.generateMultiDayPackingList(tripData, this.data.gear);
    }

    // 注入 packed 状态
    var packedItems = this.data.packedItems;
    if (result && result.items) {
      result.items.forEach(function (item) {
        item.packed = !!packedItems[item.id];
      });
    }

    // 目的地链
    var chain = tripData.dayPlans
      .filter(function (d) { return d.destination && d.destination.trim(); })
      .map(function (d) { return d.destination.trim(); })
      .join(' → ');

    var dayPlans = this.data.dayPlans;
    var campingDays = dayPlans.filter(function (d) { return d.stayType === 'camping'; }).length;
    var hotelDays = dayPlans.length - campingDays;

    var smartLodgeHint = '';
    if (campingDays === 0) {
      smartLodgeHint = '全程旅馆';
    } else if (hotelDays === 0) {
      smartLodgeHint = '扎营 ' + campingDays + ' 天';
    } else {
      smartLodgeHint = '扎营 ' + campingDays + ' 天 · 旅馆 ' + hotelDays + ' 天';
    }

    var totalWeightDisplay = result
      ? recommendation.formatWeight(result.totalWeight)
      : '0 g';

    var packingGrouped = result
      ? this._buildPackingGrouped(result.items, this.data.expandedPackCategories)
      : [];

    this.setData({
      result: result,
      totalWeightDisplay: totalWeightDisplay,
      packingGrouped: packingGrouped,
      destinationChain: chain,
      smartLodgeHint: smartLodgeHint
    });

    this._updatePackingStats();
  },

  /** 更新打包统计 */
  _updatePackingStats: function () {
    var result = this.data.result;
    if (!result || !result.items) {
      this.setData({ packedCount: 0, packedWeight: 0, packedPercent: 0 });
      return;
    }

    var packedCount = 0;
    var packedWeight = 0;
    result.items.forEach(function (item) {
      if (item.packed) {
        packedCount++;
        packedWeight += item.weight * item.quantity;
      }
    });

    var totalItems = result.items.length;
    var percent = totalItems > 0 ? Math.round((packedCount / totalItems) * 100) : 0;

    this.setData({
      packedCount: packedCount,
      packedWeight: packedWeight,
      packedPercent: percent
    });
  },

  /** 更新装备数据并刷新分组显示 */
  _updateGearData: function (gear) {
    this.setData({
      gear: gear,
      gearGrouped: this._buildGearGrouped(gear, this.data.expandedCategories),
      gearCount: gear.length,
      gearWeight: gear.reduce(function (s, it) { return s + it.weight; }, 0)
    });
  },

  /** 空操作 — 阻止冒泡 */
  noop: function () {}
});
