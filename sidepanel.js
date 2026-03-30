document.addEventListener('DOMContentLoaded', async function() {
  console.log('[X记录器SidePanel] 加载中...');

  var currentFilter = 'for-you';
  var startDate = null;
  var endDate = null;
  var refreshInterval = null;

  // 尝试注入内容脚本
  await injectScriptIfNeeded();

  // 初始化标签页
  initTabs();
  
  // 初始化日期筛选
  initDateFilter();
  
  // 加载时间线
  await loadTimeline();
  
  // 启动自动刷新
  startAutoRefresh();

  // 初始化视图切换
  initViewToggle();

  // 尝试注入内容脚本
  async function injectScriptIfNeeded() {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs[0];
      if (!tab) return;
      
      var isX = tab.url && (tab.url.indexOf('x.com') !== -1 || tab.url.indexOf('twitter.com') !== -1);
      if (!isX) return;
      
      console.log('[X记录器SidePanel] 尝试注入脚本到:', tab.url);
      
      await chrome.runtime.sendMessage({
        type: 'inject_script',
        tabId: tab.id
      });
    } catch (e) {
      console.log('[X记录器SidePanel] 注入脚本跳过:', e.message);
    }
  }

  // 初始化视图切换按钮
  function initViewToggle() {
    // 打开小窗口按钮
    var openPopupBtn = document.getElementById('open-popup');
    if (openPopupBtn) {
      openPopupBtn.addEventListener('click', async function() {
        try {
          // 关闭侧边栏
          await chrome.sidePanel.setOptions({
            enabled: false
          });
          
          // 打开popup（通过点击扩展图标）
          console.log('[X记录器SidePanel] 已切换到小窗口模式');
          
          // 提示用户点击扩展图标
          alert('已切换到小窗口模式，请点击工具栏上的扩展图标查看');
        } catch (e) {
          console.error('[X记录器SidePanel] 切换视图失败:', e);
        }
      });
    }

    // 刷新按钮
    var refreshBtn = document.getElementById('refresh-sidepanel');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadTimeline);
    }
  }

  // 初始化标签页切换
  function initTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var tabId = btn.dataset.tab;

        // 切换激活状态
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');

        // 显示/隐藏内容
        tabContents.forEach(function(c) { c.classList.add('hidden'); });
        var targetContent = document.getElementById(tabId + '-tab');
        if (targetContent) {
          targetContent.classList.remove('hidden');
        }

        // 加载对应内容
        if (tabId === 'timeline') {
          await loadTimeline();
        } else if (tabId === 'stats') {
          await loadStats();
        } else if (tabId === 'algorithm') {
          await loadAlgorithm();
        }
      });
    });

    // 导出按钮
    var exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportData);
    }

    // 清除按钮
    var clearBtn = document.getElementById('clear-timeline-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        if (confirm('确定要清除所有记录吗？')) {
          await chrome.runtime.sendMessage({ type: 'clear_data' });
          await loadTimeline();
          await loadStats();
        }
      });
    }

    // 清除所有数据链接
    var clearAll = document.getElementById('clear-all');
    if (clearAll) {
      clearAll.addEventListener('click', async function(e) {
        e.preventDefault();
        if (confirm('确定要清除所有数据吗？此操作不可恢复。')) {
          await chrome.runtime.sendMessage({ type: 'clear_data' });
          await loadTimeline();
          await loadStats();
          await loadAlgorithm();
        }
      });
    }
  }

  // 初始化日期筛选
  function initDateFilter() {
    var startDateInput = document.getElementById('start-date');
    var endDateInput = document.getElementById('end-date');
    var presetBtns = document.querySelectorAll('.preset-btn');
    var clearBtn = document.getElementById('clear-date-filter');

    // 日期输入变化
    if (startDateInput) {
      startDateInput.addEventListener('change', async function() {
        startDate = startDateInput.value || null;
        await loadTimeline();
      });
    }

    if (endDateInput) {
      endDateInput.addEventListener('change', async function() {
        endDate = endDateInput.value || null;
        await loadTimeline();
      });
    }

    // 预设按钮
    presetBtns.forEach(function(btn) {
      if (btn.id === 'clear-date-filter') return;
      
      btn.addEventListener('click', async function() {
        var days = parseInt(btn.dataset.days);
        var end = new Date();
        var start = new Date();
        start.setDate(start.getDate() - days + 1);
        
        endDate = end.toISOString().split('T')[0];
        startDate = start.toISOString().split('T')[0];
        
        if (startDateInput) startDateInput.value = startDate;
        if (endDateInput) endDateInput.value = endDate;
        
        // 更新按钮状态
        presetBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        
        await loadTimeline();
      });
    });

    // 清除日期筛选
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        startDate = null;
        endDate = null;
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        
        presetBtns.forEach(function(b) { b.classList.remove('active'); });
        
        await loadTimeline();
      });
    }
  }

  // 加载时间线
  async function loadTimeline() {
    try {
      console.log('[X记录器SidePanel] 加载时间线...');

      // 检查是否在X页面
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var currentTab = tabs[0];
      var isOnX = currentTab && (currentTab.url?.includes('x.com') || currentTab.url?.includes('twitter.com'));

      // 更新状态
      var statusBadge = document.getElementById('status-badge');
      if (statusBadge) {
        if (isOnX) {
          statusBadge.textContent = '🟢 正在记录';
          statusBadge.classList.add('recording');
        } else {
          statusBadge.textContent = '🔴 未记录';
          statusBadge.classList.remove('recording');
        }
      }

      // 获取数据（带日期筛选）
      var history = await chrome.runtime.sendMessage({ 
        type: 'get_history', 
        limit: 100,
        timelineType: currentFilter === 'all' ? null : currentFilter,
        startDate: startDate,
        endDate: endDate
      });

      console.log('[X记录器SidePanel] 获取到', history.tweets?.length || 0, '条推文');

      // 更新统计数字
      var allHistory = await chrome.runtime.sendMessage({ 
        type: 'get_history', 
        limit: 1000 
      });

      var totalEl = document.getElementById('timeline-total');
      var promotedEl = document.getElementById('timeline-promoted');
      var sessionEl = document.getElementById('timeline-session');

      if (totalEl) totalEl.textContent = allHistory.tweets?.length || 0;
      if (promotedEl) {
        var promotedCount = allHistory.tweets?.filter(function(t) { return t.isPromoted; }).length || 0;
        promotedEl.textContent = promotedCount;
      }
      if (sessionEl) sessionEl.textContent = history.tweets?.length || 0;

      // 渲染列表
      var listEl = document.getElementById('timeline-list');
      if (!listEl) return;

      if (history.tweets && history.tweets.length > 0) {
        listEl.innerHTML = history.tweets.map(function(tweet) {
          return `
            <div class="timeline-item ${tweet.isPromoted ? 'promoted' : ''}" data-tweet-id="${tweet.id}" data-author="${tweet.authorHandle || 'unknown'}" title="点击查看推文">
              <div class="timeline-position">#${tweet.position || '?'}</div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <span class="timeline-type-badge ${tweet.timelineType || 'for-you'}">${tweet.timelineType === 'following' ? '关注' : '为你'}</span>
                  <span class="timeline-author">@${escapeHtml(tweet.authorHandle || 'unknown')}</span>
                  <span class="timeline-time">${formatTime(tweet.recordedAt)}</span>
                </div>
                <div class="timeline-text">${escapeHtml((tweet.content || '').substring(0, 120))}${(tweet.content || '').length > 120 ? '...' : ''}</div>
                <div class="timeline-meta">
                  <span class="meta-item">${getMediaIcon(tweet.mediaType)} ${formatNumber(tweet.likes || 0)}</span>
                  ${tweet.isPromoted ? '<span class="promoted-tag">推广</span>' : ''}
                  ${tweet.isReply ? '<span class="reply-tag">回复</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
        
        // 添加点击事件
        listEl.querySelectorAll('.timeline-item').forEach(function(item) {
          item.addEventListener('click', async function() {
            var tweetId = item.dataset.tweetId;
            var author = item.dataset.author;
            if (tweetId && author) {
              var url = 'https://x.com/' + author + '/status/' + tweetId;
              await chrome.tabs.create({ url: url });
            }
          });
        });
      } else {
        listEl.innerHTML = `
          <div class="empty-state">
            <p>暂无记录</p>
            ${isOnX ? '<p class="hint">向下滚动查看推文</p>' : '<p class="hint">打开 x.com 开始记录</p>'}
          </div>
        `;
      }
    } catch (e) {
      console.error('[X记录器SidePanel] 加载时间线失败:', e);
    }
  }

  // 加载统计
  async function loadStats() {
    try {
      console.log('[X记录器SidePanel] 加载统计...');
      
      var stats = await chrome.runtime.sendMessage({ type: 'get_stats' });

      // 时间线对比
      var forYouEl = document.getElementById('for-you-count');
      var followingEl = document.getElementById('following-count');
      
      if (forYouEl) forYouEl.textContent = formatNumber(stats.forYouCount || 0);
      if (followingEl) followingEl.textContent = formatNumber(stats.followingCount || 0);

      // 统计数据
      var recordedEl = document.getElementById('total-recorded');
      var uniqueEl = document.getElementById('unique-tweets');
      var timeEl = document.getElementById('total-time');
      var sessionEl = document.getElementById('avg-session');

      if (recordedEl) recordedEl.textContent = formatNumber(stats.totalTweetsRecorded || 0);
      if (uniqueEl) uniqueEl.textContent = formatNumber(stats.totalUniqueTweets || 0);
      if (timeEl) timeEl.textContent = formatDuration(stats.totalTimeSpent || 0);
      if (sessionEl) sessionEl.textContent = formatDuration(stats.averageSessionDuration || 0);

      // 互动统计
      var likesEl = document.getElementById('likes');
      var retweetsEl = document.getElementById('retweets');
      var repliesEl = document.getElementById('replies');
      var bookmarksEl = document.getElementById('bookmarks');

      if (likesEl) likesEl.textContent = stats.interactionCounts?.likes || 0;
      if (retweetsEl) retweetsEl.textContent = stats.interactionCounts?.retweets || 0;
      if (repliesEl) repliesEl.textContent = stats.interactionCounts?.replies || 0;
      if (bookmarksEl) bookmarksEl.textContent = stats.interactionCounts?.bookmarks || 0;

      // 热门作者
      var authorsEl = document.getElementById('top-authors');
      if (authorsEl && stats.topAuthors) {
        if (stats.topAuthors.length > 0) {
          authorsEl.innerHTML = stats.topAuthors
            .map(function(author, i) {
              return `
                <div class="author-item">
                  <span class="author-rank">${i + 1}</span>
                  <span class="author-name">@${escapeHtml(author.handle)}</span>
                  <span class="author-count">${author.count}</span>
                </div>
              `;
            }).join('');
        } else {
          authorsEl.innerHTML = '<p class="empty-state">暂无数据</p>';
        }
      }

      // 热门话题
      var hashtagsEl = document.getElementById('top-hashtags');
      if (hashtagsEl && stats.topHashtags) {
        if (stats.topHashtags.length > 0) {
          hashtagsEl.innerHTML = stats.topHashtags
            .map(function(tag) {
              return '<span class="hashtag-item">#' + escapeHtml(tag.tag) + '</span>';
            }).join('');
        } else {
          hashtagsEl.innerHTML = '<p class="empty-state">暂无数据</p>';
        }
      }
    } catch (e) {
      console.error('[X记录器SidePanel] 加载统计失败:', e);
    }
  }

  // 加载算法分析
  async function loadAlgorithm() {
    try {
      console.log('[X记录器SidePanel] 加载算法分析...');
      
      var analysis = await chrome.runtime.sendMessage({ type: 'get_timeline_analysis' });
      var stats = await chrome.runtime.sendMessage({ type: 'get_stats' });

      // 推广分析
      var promotedPercentEl = document.getElementById('promoted-percent');
      var promotedPositionEl = document.getElementById('promoted-position');

      if (promotedPercentEl) {
        promotedPercentEl.textContent = (analysis.promotedAnalysis?.percentage || 0) + '%';
      }
      if (promotedPositionEl) {
        var pos = analysis.promotedAnalysis?.averagePosition || 0;
        promotedPositionEl.textContent = pos > 0 ? '第 ' + pos + ' 位' : '-';
      }

      // 内容类型
      var types = analysis.contentTypeAnalysis || {};
      var total = types.total || 1;

      var textBar = document.getElementById('text-bar');
      var imageBar = document.getElementById('image-bar');
      var videoBar = document.getElementById('video-bar');
      var cardBar = document.getElementById('card-bar');

      if (textBar) textBar.style.width = ((types.text || 0) / total * 100) + '%';
      if (imageBar) imageBar.style.width = ((types.image || 0) / total * 100) + '%';
      if (videoBar) videoBar.style.width = ((types.video || 0) / total * 100) + '%';
      if (cardBar) cardBar.style.width = ((types.card || 0) / total * 100) + '%';

      var textCount = document.getElementById('text-count');
      var imageCount = document.getElementById('image-count');
      var videoCount = document.getElementById('video-count');
      var cardCount = document.getElementById('card-count');

      if (textCount) textCount.textContent = types.text || 0;
      if (imageCount) imageCount.textContent = types.image || 0;
      if (videoCount) videoCount.textContent = types.video || 0;
      if (cardCount) cardCount.textContent = types.card || 0;

      // 特征列表
      var featuresEl = document.getElementById('algorithm-features');
      if (featuresEl) {
        if (analysis.features && analysis.features.length > 0) {
          featuresEl.innerHTML = analysis.features
            .map(function(f) {
              return '<li>' + escapeHtml(f) + '</li>';
            }).join('');
        } else {
          featuresEl.innerHTML = '<li>继续浏览以获取更多洞察</li>';
        }
      }

      // 概览
      var diversityEl = document.getElementById('author-diversity');
      var hashtagCountEl = document.getElementById('hashtag-count');
      var replyCountEl = document.getElementById('reply-count');
      var engagementEl = document.getElementById('engagement-rate');

      if (diversityEl) diversityEl.textContent = formatNumber(analysis.authorDiversity || 0);
      if (hashtagCountEl) hashtagCountEl.textContent = formatNumber(analysis.hashtagCount || 0);
      if (replyCountEl) replyCountEl.textContent = formatNumber(analysis.replyCount || 0);

      if (engagementEl) {
        var totalInteractions = (stats.interactionCounts?.likes || 0) + 
                                 (stats.interactionCounts?.retweets || 0) + 
                                 (stats.interactionCounts?.replies || 0) + 
                                 (stats.interactionCounts?.bookmarks || 0);
        var rate = stats.totalTweetsRecorded > 0 
          ? ((totalInteractions / stats.totalTweetsRecorded) * 100).toFixed(1)
          : 0;
        engagementEl.textContent = rate + '%';
      }
    } catch (e) {
      console.error('[X记录器SidePanel] 加载算法分析失败:', e);
    }
  }

  // 导出数据
  async function exportData() {
    try {
      var history = await chrome.runtime.sendMessage({ type: 'get_history', limit: 10000 });
      
      var data = {
        exportDate: new Date().toISOString(),
        totalTweets: history.tweets.length,
        tweets: history.tweets
      };

      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      
      var a = document.createElement('a');
      a.href = url;
      a.download = 'x-timeline-' + new Date().toISOString().split('T')[0] + '.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[X记录器SidePanel] 导出失败:', e);
      alert('导出失败');
    }
  }

  // 自动刷新
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    
    refreshInterval = setInterval(function() {
      var timelineTab = document.getElementById('timeline-tab');
      if (timelineTab && !timelineTab.classList.contains('hidden')) {
        loadTimeline();
      }
    }, 3000);
  }

  // 工具函数
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  function formatDuration(ms) {
    if (!ms || ms < 1000) return '0s';
    var sec = Math.floor(ms / 1000);
    var min = Math.floor(sec / 60);
    var hr = Math.floor(min / 60);
    var day = Math.floor(hr / 24);
    
    if (day > 0) return day + '天';
    if (hr > 0) return hr + '小时';
    if (min > 0) return min + '分钟';
    return sec + '秒';
  }

  function formatTime(ts) {
    if (!ts) return '-';
    var date = new Date(ts);
    var now = new Date();
    var diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getMediaIcon(type) {
    var icons = { text: '📝', image: '🖼️', video: '🎥', card: '🔗' };
    return icons[type] || '📝';
  }

  console.log('[X记录器SidePanel] 初始化完成');
});
