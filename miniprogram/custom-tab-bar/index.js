Component({
  data: {
    route: '',
    tabs: [
      { route: 'pages/overview/overview', text: '准备', icon: 'prepare' },
      { route: 'pages/gear/gear', text: '装备', icon: 'gear' },
      { route: 'pages/history/history', text: '经历', icon: 'history' }
    ]
  },
  lifetimes: { attached() { this.syncRoute(); } },
  pageLifetimes: { show() { this.syncRoute(); } },
  methods: {
    syncRoute() {
      const stack = getCurrentPages();
      const page = stack[stack.length - 1];
      if (page) this.setData({ route: page.route });
    }
  }
});
