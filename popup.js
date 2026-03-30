document.addEventListener('DOMContentLoaded', async function() {
  console.log('[X记录器Popup] 加载中...');

  let currentFilter = 'all';
  let startDate = null;
  let endDate = null;
  let refreshInterval = null;

  // 尝试注入内容脚本
  await injectScriptIfNeeded();

  // 初始化标签页
  initTabs();

  // 初始化侧边栏切换
  initSidePanelToggle();
  
  // 初始化日期筛选
  initDateFilter();
  
  // 加载时间线
  await loadTimeline();
  
  // 启动自动刷新
  startAutoRefresh();

  // 尝试注入内容脚本
  async function injectScriptIfNeeded() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      const isX = tab.url && (tab.url.includes('x.com') || tab.url.includes('twitter.com'));
      if (!isX) return;
      
      console.log('[X记录器Popup] 尝试注入脚本到:', tab.url);
      
      // 发送消息给后台注入脚本
      await chrome.runtime.sendMessage({
        type: 'inject_script',
        tabId: tab.id
      });
    } catch (e) {
      console.log('[X记录器Popup] 注入脚本跳过:', e.message);
    }
  }

  // 初始化侧边栏切换
  function initSidePanelToggle() {
    const openSidePanelBtn = document.getElementById('open-sidepanel');
    if (openSidePanelBtn) {
      openSidePanelBtn.addEventListener('click', async () => {
        try {
          // 获取当前窗口ID
          const currentWindow = await chrome.windows.getCurrent();
          
          // 检查侧边栏是否已经打开
          try {
            // 尝试获取侧边栏状态
            const panelWindow = await chrome.sidePanel.getOptions({ windowId: currentWindow.id });
            console.log('[X记录器Popup] 当前侧边栏状态:', panelWindow);
          } catch (panelErr) {
            // 侧边栏可能未启用，继续尝试打开
            console.log('[X记录器Popup] 检查侧边栏状态:', panelErr.message);
          }
          
          // 打开侧边栏
          await chrome.sidePanel.open({ windowId: currentWindow.id });
          console.log('[X记录器Popup] 已打开侧边栏');
          
          // 关闭popup
          window.close();
        } catch (e) {
          console.error('[X记录器Popup] 打开侧边栏失败:', e);
          
          // 检查是否是侧边栏已经打开的错误（chrome 的特殊错误信息）
          if (e.message && (e.message.includes('No active side panel') || e.message.includes('already open'))) {
            // 侧边栏已经打开了，直接关闭popup即可
            console.log('[X记录器Popup] 侧边栏已经打开，关闭popup');
            window.close();
            return;
          }
          
          // 检查扩展上下文是否已失效
          if (e.message && e.message.includes('Extension context invalidated')) {
            console.log('[X记录器Popup] 扩展已更新，请重新打开');
            window.close();
            return;
          }
          
          // 提供更详细的错误信息
          let errorMsg = '无法打开侧边栏';
          if (e.message && e.message.includes('sidePanel')) {
            errorMsg = '您的浏览器版本可能不支持侧边栏功能（需要 Chrome 114+）';
          } else if (e.message) {
            errorMsg = '错误: ' + e.message;
          }
          
          alert(errorMsg + '\n\n替代方法：右键点击扩展图标 → 选择"打开侧边栏"');
        }
      });
    }
  }

  // 初始化标签页切换
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const tabId = btn.dataset.tab;

        // 切换激活状态
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 显示/隐藏内容
        tabContents.forEach(c => c.classList.add('hidden'));
        const targetContent = document.getElementById(tabId + '-tab');
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

    // 筛选按钮
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        await loadTimeline();
      });
    });

    // 刷新按钮
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadTimeline);
    }

    // 导出按钮
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportData);
    }

    // 清除按钮
    const clearBtn = document.getElementById('clear-timeline-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm('确定要清除所有记录吗？')) {
          await chrome.runtime.sendMessage({ type: 'clear_data' });
          await loadTimeline();
          await loadStats();
        }
      });
    }

    // 清除所有数据链接
    const clearAll = document.getElementById('clear-all');
    if (clearAll) {
      clearAll.addEventListener('click', async (e) => {
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
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const clearBtn = document.getElementById('clear-date-filter');

    // 日期输入变化
    if (startDateInput) {
      startDateInput.addEventListener('change', async () => {
        startDate = startDateInput.value || null;
        await loadTimeline();
      });
    }

    if (endDateInput) {
      endDateInput.addEventListener('change', async () => {
        endDate = endDateInput.value || null;
        await loadTimeline();
      });
    }

    // 预设按钮
    presetBtns.forEach(btn => {
      if (btn.id === 'clear-date-filter') return;
      
      btn.addEventListener('click', async () => {
        const days = parseInt(btn.dataset.days);
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days + 1);
        
        endDate = end.toISOString().split('T')[0];
        startDate = start.toISOString().split('T')[0];
        
        if (startDateInput) startDateInput.value = startDate;
        if (endDateInput) endDateInput.value = endDate;
        
        // 更新按钮状态
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        await loadTimeline();
      });
    });

    // 清除日期筛选
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        startDate = null;
        endDate = null;
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        
        presetBtns.forEach(b => b.classList.remove('active'));
        
        await loadTimeline();
      });
    }
  }

  // 加载时间线
  async function loadTimeline() {
    try {
      console.log('[X记录器Popup] 加载时间线...');

      // 检查是否在X页面
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      const isOnX = currentTab && (currentTab.url?.includes('x.com') || currentTab.url?.includes('twitter.com'));

      // 更新状态
      const statusBadge = document.getElementById('status-badge');
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
      const history = await chrome.runtime.sendMessage({ 
        type: 'get_history', 
        limit: 50,
        timelineType: currentFilter === 'all' ? null : currentFilter,
        startDate: startDate,
        endDate: endDate
      });

      console.log('[X记录器Popup] 获取到', history.tweets?.length || 0, '条推文');

      // 更新统计数字
      const allHistory = await chrome.runtime.sendMessage({ 
        type: 'get_history', 
        limit: 1000 
      });

      const totalEl = document.getElementById('timeline-total');
      const promotedEl = document.getElementById('timeline-promoted');
      const sessionEl = document.getElementById('timeline-session');

      if (totalEl) totalEl.textContent = allHistory.tweets?.length || 0;
      if (promotedEl) {
        const promotedCount = allHistory.tweets?.filter(t => t.isPromoted).length || 0;
        promotedEl.textContent = promotedCount;
      }
      if (sessionEl) sessionEl.textContent = history.tweets?.length || 0;

      // 渲染列表
      const listEl = document.getElementById('timeline-list');
      if (!listEl) return;

      if (history.tweets && history.tweets.length > 0) {
        listEl.innerHTML = history.tweets.map(tweet => `
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
        `).join('');
        
        // 添加点击事件
        listEl.querySelectorAll('.timeline-item').forEach(item => {
          item.addEventListener('click', async () => {
            const tweetId = item.dataset.tweetId;
            const author = item.dataset.author;
            if (tweetId && author) {
              const url = `https://x.com/${author}/status/${tweetId}`;
              await chrome.tabs.create({ url });
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
      console.error('[X记录器Popup] 加载时间线失败:', e);
    }
  }

  // 加载统计
  async function loadStats() {
    try {
      console.log('[X记录器Popup] 加载统计...');
      
      const stats = await chrome.runtime.sendMessage({ type: 'get_stats' });

      // 时间线对比
      const forYouEl = document.getElementById('for-you-count');
      const followingEl = document.getElementById('following-count');
      
      if (forYouEl) forYouEl.textContent = formatNumber(stats.forYouCount || 0);
      if (followingEl) followingEl.textContent = formatNumber(stats.followingCount || 0);

      // 统计数据
      const recordedEl = document.getElementById('total-recorded');
      const uniqueEl = document.getElementById('unique-tweets');
      const timeEl = document.getElementById('total-time');
      const sessionEl = document.getElementById('avg-session');

      if (recordedEl) recordedEl.textContent = formatNumber(stats.totalTweetsRecorded || 0);
      if (uniqueEl) uniqueEl.textContent = formatNumber(stats.totalUniqueTweets || 0);
      if (timeEl) timeEl.textContent = formatDuration(stats.totalTimeSpent || 0);
      if (sessionEl) sessionEl.textContent = formatDuration(stats.averageSessionDuration || 0);

      // 互动统计
      const likesEl = document.getElementById('likes');
      const retweetsEl = document.getElementById('retweets');
      const repliesEl = document.getElementById('replies');
      const bookmarksEl = document.getElementById('bookmarks');

      if (likesEl) likesEl.textContent = stats.interactionCounts?.likes || 0;
      if (retweetsEl) retweetsEl.textContent = stats.interactionCounts?.retweets || 0;
      if (repliesEl) repliesEl.textContent = stats.interactionCounts?.replies || 0;
      if (bookmarksEl) bookmarksEl.textContent = stats.interactionCounts?.bookmarks || 0;

      // 热门作者
      const authorsEl = document.getElementById('top-authors');
      if (authorsEl && stats.topAuthors) {
        if (stats.topAuthors.length > 0) {
          authorsEl.innerHTML = stats.topAuthors
            .map((author, i) => `
              <div class="author-item">
                <span class="author-rank">${i + 1}</span>
                <span class="author-name">@${escapeHtml(author.handle)}</span>
                <span class="author-count">${author.count}</span>
              </div>
            `).join('');
        } else {
          authorsEl.innerHTML = '<p class="empty-state">暂无数据</p>';
        }
      }

      // 热门话题
      const hashtagsEl = document.getElementById('top-hashtags');
      if (hashtagsEl && stats.topHashtags) {
        if (stats.topHashtags.length > 0) {
          hashtagsEl.innerHTML = stats.topHashtags
            .map(tag => `<span class="hashtag-item">#${escapeHtml(tag.tag)}</span>
            `).join('');
        } else {
          hashtagsEl.innerHTML = '<p class="empty-state">暂无数据</p>';
        }
      }
    } catch (e) {
      console.error('[X记录器Popup] 加载统计失败:', e);
    }
  }

  // 加载算法分析
  async function loadAlgorithm() {
    try {
      console.log('[X记录器Popup] 加载算法分析...');
      
      const analysis = await chrome.runtime.sendMessage({ type: 'get_timeline_analysis' });
      const stats = await chrome.runtime.sendMessage({ type: 'get_stats' });

      // 推广分析
      const promotedPercentEl = document.getElementById('promoted-percent');
      const promotedPositionEl = document.getElementById('promoted-position');

      if (promotedPercentEl) {
        promotedPercentEl.textContent = (analysis.promotedAnalysis?.percentage || 0) + '%';
      }
      if (promotedPositionEl) {
        const pos = analysis.promotedAnalysis?.averagePosition || 0;
        promotedPositionEl.textContent = pos > 0 ? `第 ${pos} 位` : '-';
      }

      // 内容类型
      const types = analysis.contentTypeAnalysis || {};
      const total = types.total || 1;

      const textBar = document.getElementById('text-bar');
      const imageBar = document.getElementById('image-bar');
      const videoBar = document.getElementById('video-bar');
      const cardBar = document.getElementById('card-bar');

      if (textBar) textBar.style.width = ((types.text || 0) / total * 100) + '%';
      if (imageBar) imageBar.style.width = ((types.image || 0) / total * 100) + '%';
      if (videoBar) videoBar.style.width = ((types.video || 0) / total * 100) + '%';
      if (cardBar) cardBar.style.width = ((types.card || 0) / total * 100) + '%';

      const textCount = document.getElementById('text-count');
      const imageCount = document.getElementById('image-count');
      const videoCount = document.getElementById('video-count');
      const cardCount = document.getElementById('card-count');

      if (textCount) textCount.textContent = types.text || 0;
      if (imageCount) imageCount.textContent = types.image || 0;
      if (videoCount) videoCount.textContent = types.video || 0;
      if (cardCount) cardCount.textContent = types.card || 0;

      // 特征列表
      const featuresEl = document.getElementById('algorithm-features');
      if (featuresEl) {
        if (analysis.features && analysis.features.length > 0) {
          featuresEl.innerHTML = analysis.features
            .map(f => `<li>${escapeHtml(f)}</li>
            `).join('');
        } else {
          featuresEl.innerHTML = '<li>继续浏览以获取更多洞察</li>';
        }
      }

      // 概览
      const diversityEl = document.getElementById('author-diversity');
      const hashtagCountEl = document.getElementById('hashtag-count');
      const replyCountEl = document.getElementById('reply-count');
      const engagementEl = document.getElementById('engagement-rate');

      if (diversityEl) diversityEl.textContent = formatNumber(analysis.authorDiversity || 0);
      if (hashtagCountEl) hashtagCountEl.textContent = formatNumber(analysis.hashtagCount || 0);
      if (replyCountEl) replyCountEl.textContent = formatNumber(analysis.replyCount || 0);

      if (engagementEl) {
        const totalInteractions = (stats.interactionCounts?.likes || 0) + 
                                 (stats.interactionCounts?.retweets || 0) + 
                                 (stats.interactionCounts?.replies || 0) + 
                                 (stats.interactionCounts?.bookmarks || 0);
        const rate = stats.totalTweetsRecorded > 0 
          ? ((totalInteractions / stats.totalTweetsRecorded) * 100).toFixed(1)
          : 0;
        engagementEl.textContent = rate + '%';
      }
    } catch (e) {
      console.error('[X记录器Popup] 加载算法分析失败:', e);
    }
  }

  // 导出数据
  async function exportData() {
    try {
      const history = await chrome.runtime.sendMessage({ type: 'get_history', limit: 10000 });
      
      const data = {
        exportDate: new Date().toISOString(),
        totalTweets: history.tweets.length,
        tweets: history.tweets
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `x-timeline-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[X记录器Popup] 导出失败:', e);
      alert('导出失败');
    }
  }

  // 自动刷新
  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    
    refreshInterval = setInterval(() => {
      const timelineTab = document.getElementById('timeline-tab');
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
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);
    
    if (day > 0) return day + '天';
    if (hr > 0) return hr + '小时';
    if (min > 0) return min + '分钟';
    return sec + '秒';
  }

  function formatTime(ts) {
    if (!ts) return '-';
    const date = new Date(ts);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getMediaIcon(type) {
    const icons = { text: '📝', image: '🖼️', video: '🎥', card: '🔗' };
    return icons[type] || '📝';
  }

  console.log('[X记录器Popup] 初始化完成');
});
