// X为你推荐时间线记录器 - 内容脚本 v2.0
// 自动记录所有出现在时间线上的推文

(function() {
  'use strict';

  console.log('[X记录器 v2.0] 启动中...');

  // 会话数据
  let sessionData = {
    sessionId: 'session_' + Date.now(),
    startTime: Date.now(),
    timelineType: 'for-you',
    tweets: [],
    interactions: [],
    scrollPosition: 0
  };

  // 已记录的推文ID
  const recordedIds = new Set();
  let tweetPosition = 0;
  let isRecording = false;
  let observer = null;

  // 检测时间线类型
  function getTimelineType() {
    const url = window.location.href;
    if (url.includes('/following')) return 'following';
    return 'for-you';
  }

  // 提取推文ID - 改进版
  function getTweetId(element) {
    // 方法1: 从所有链接中查找包含status的
    const allLinks = element.querySelectorAll('a');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      if (href.includes('/status/')) {
        const match = href.match(/status\/(\d+)/);
        if (match) return match[1];
      }
    }
    
    // 方法2: 从当前元素的href
    const directLink = element.getAttribute('href');
    if (directLink && directLink.includes('/status/')) {
      const match = directLink.match(/status\/(\d+)/);
      if (match) return match[1];
    }
    
    // 方法3: 从aria-describedby
    const desc = element.getAttribute('aria-describedby');
    if (desc) {
      const match = desc.match(/(\d{10,})/);
      if (match) return match[1];
    }
    
    return null;
  }

  // 提取作者 - 改进版
  function getAuthor(element) {
    // 方法1: User-Name testid
    const userNameEl = element.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const links = userNameEl.querySelectorAll('a');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.startsWith('/') && !href.includes('/status/')) {
          const match = href.match(/^\/(\w+)$/);
          if (match && match[1].length > 1) {
            return match[1];
          }
        }
      }
      // 从文本中提取
      const text = userNameEl.textContent;
      const match = text.match(/@(\w+)/);
      if (match) return match[1];
    }
    
    // 方法2: 查找作者链接
    const authorLinks = element.querySelectorAll('a[role="link"]');
    for (const link of authorLinks) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('/') && !href.includes('/status/') && !href.includes('?')) {
        const match = href.match(/^\/(\w+)$/);
        if (match) {
          const username = match[1];
          // 排除常见非用户路径
          if (!['i', 'settings', 'explore', 'notifications', 'messages', 'home'].includes(username)) {
            return username;
          }
        }
      }
    }
    
    return 'unknown';
  }

  // 提取内容
  function getContent(element) {
    const textEl = element.querySelector('[data-testid="tweetText"]');
    if (textEl) {
      return textEl.textContent.trim().substring(0, 500);
    }
    return '';
  }

  // 提取互动数
  function getCount(element, testId) {
    const el = element.querySelector(`[data-testid="${testId}"]`);
    if (!el) return 0;
    
    const text = el.textContent || '';
    const num = text.replace(/,/g, '').match(/([\d.]+)([KM]?)/i);
    
    if (num) {
      let val = parseFloat(num[1]);
      const suffix = num[2]?.toUpperCase();
      if (suffix === 'K') val *= 1000;
      if (suffix === 'M') val *= 1000000;
      return Math.round(val);
    }
    
    return 0;
  }

  // 检查是否推广
  function isPromoted(element) {
    const text = element.textContent || '';
    return text.includes('推广') || 
           text.includes('Promoted') ||
           text.includes('广告') ||
           element.querySelector('[data-testid="promoted-tweet"]') !== null;
  }

  // 检查媒体类型
  function getMediaType(element) {
    if (element.querySelector('[data-testid="videoPlayer"]') || 
        element.querySelector('video')) return 'video';
    if (element.querySelector('[data-testid="tweetPhoto"]') ||
        element.querySelector('img[alt*="Image"]')) return 'image';
    if (element.querySelector('[data-testid="card.wrapper"]') ||
        element.querySelector('a[href*="card"]')) return 'card';
    return 'text';
  }

  // 检查是否回复
  function isReply(element) {
    const socialContext = element.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
      const text = socialContext.textContent || '';
      return text.includes('回复') || text.includes('Replying');
    }
    return false;
  }

  // 提取话题标签
  function getHashtags(element) {
    const tags = [];
    element.querySelectorAll('a[href*="/hashtag/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const match = href.match(/hashtag\/([^?/]+)/);
      if (match) {
        tags.push(decodeURIComponent(match[1]));
      }
    });
    return [...new Set(tags)];
  }

  // 记录推文
  function recordTweet(element) {
    try {
      // 获取推文ID
      const tweetId = getTweetId(element);
      if (!tweetId) {
        return false;
      }
      
      // 检查是否已记录
      if (recordedIds.has(tweetId)) {
        return false;
      }

      // 获取作者
      const authorHandle = getAuthor(element);
      if (authorHandle === 'unknown') {
        // 再试一次，可能是结构问题
        setTimeout(() => {
          const retryAuthor = getAuthor(element);
          if (retryAuthor !== 'unknown' && !recordedIds.has(tweetId)) {
            doRecord(element, tweetId, retryAuthor);
          }
        }, 500);
        return false;
      }

      return doRecord(element, tweetId, authorHandle);
    } catch (e) {
      console.error('[X记录器] 记录失败:', e);
      return false;
    }
  }

  // 实际记录函数
  function doRecord(element, tweetId, authorHandle) {
    tweetPosition++;
    recordedIds.add(tweetId);

    const tweetData = {
      id: tweetId,
      position: tweetPosition,
      authorHandle: authorHandle,
      content: getContent(element),
      likes: getCount(element, 'like'),
      retweets: getCount(element, 'retweet'),
      replies: getCount(element, 'reply'),
      isPromoted: isPromoted(element),
      mediaType: getMediaType(element),
      isReply: isReply(element),
      hashtags: getHashtags(element),
      timelineType: getTimelineType(),
      recordedAt: Date.now(),
      recordedDate: new Date().toISOString().split('T')[0] // 添加日期字段
    };

    sessionData.tweets.push(tweetData);
    
    console.log(`[X记录器] ✓ #${tweetPosition} @${tweetData.authorHandle} ${tweetData.isPromoted ? '[推广]' : ''}`);

    // 发送给后台
    chrome.runtime.sendMessage({
      type: 'new_tweet',
      data: tweetData,
      sessionId: sessionData.sessionId
    }).then(() => {
      console.log(`[X记录器] 已保存到后台: ${tweetId}`);
    }).catch(err => {
      console.error('[X记录器] 保存失败:', err);
    });

    return true;
  }

  // 扫描推文 - 改进版
  function scanTweets() {
    if (!isRecording) return;
    
    let found = 0;
    let scanned = 0;
    
    // 主要方法：查找所有article元素
    const articles = document.querySelectorAll('article');
    scanned = articles.length;
    
    articles.forEach(article => {
      if (recordTweet(article)) {
        found++;
      }
    });

    if (scanned > 0) {
      console.log(`[X记录器] 扫描: ${scanned} 篇文章, 新记录: ${found}, 总计: ${sessionData.tweets.length}`);
    }
  }

  // 启动记录
  function startRecording() {
    if (isRecording) {
      console.log('[X记录器] 已经在记录中');
      return;
    }
    
    console.log('[X记录器] 🚀 开始记录');
    isRecording = true;
    
    // 立即扫描一次
    scanTweets();
    
    // 创建观察器
    if (observer) {
      observer.disconnect();
    }
    
    observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查是否是article或包含article
            if (node.tagName === 'ARTICLE' || 
                (node.querySelector && node.querySelector('article'))) {
              hasNewNodes = true;
            }
          }
        });
      });

      if (hasNewNodes) {
        // 延迟扫描，等待DOM稳定
        setTimeout(scanTweets, 200);
      }
    });
    
    // 观察整个文档
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    console.log('[X记录器] 观察器已启动');
    
    // 定期扫描作为备份
    setInterval(() => {
      scanTweets();
    }, 3000);
  }

  // 监听URL变化（X是SPA）
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      console.log('[X记录器] URL变化:', location.href);
      lastUrl = location.href;
      
      // 重置计数器（可选）
      // tweetPosition = 0;
      
      // 延迟后扫描
      setTimeout(scanTweets, 1000);
    }
  }, 1000);

  // 监听滚动
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    sessionData.scrollPosition = window.scrollY;
    
    // 滚动停止后扫描
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      scanTweets();
    }, 300);
  });

  // 监听互动
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-testid]');
    if (!btn) return;

    const testId = btn.dataset.testid;
    const tweetEl = btn.closest('article');
    
    if (tweetEl && ['like', 'unlike', 'retweet', 'unretweet', 'reply', 'bookmark'].includes(testId)) {
      const tweetId = getTweetId(tweetEl);
      if (tweetId) {
        sessionData.interactions.push({
          type: testId,
          tweetId,
          timestamp: Date.now()
        });
        
        chrome.runtime.sendMessage({
          type: 'interaction',
          data: { type: testId, tweetId, timestamp: Date.now() },
          sessionId: sessionData.sessionId
        }).catch(() => {});
      }
    }
  });

  // 定期同步会话
  setInterval(() => {
    if (sessionData.tweets.length > 0) {
      chrome.runtime.sendMessage({
        type: 'session_sync',
        data: {
          sessionId: sessionData.sessionId,
          timelineType: getTimelineType(),
          tweetCount: sessionData.tweets.length
        }
      }).catch(() => {});
    }
  }, 10000);

  // 页面卸载
  window.addEventListener('beforeunload', () => {
    if (sessionData.tweets.length > 0) {
      chrome.runtime.sendMessage({
        type: 'session_end',
        data: sessionData
      }).catch(() => {});
    }
  });

  // 启动逻辑
  function init() {
    console.log('[X记录器] 初始化...');
    
    // 检查是否在X上
    if (!location.href.includes('x.com') && !location.href.includes('twitter.com')) {
      console.log('[X记录器] 不在X页面，等待...');
      return;
    }
    
    // 等待页面加载
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startRecording);
    } else {
      startRecording();
    }
    
    // 多次尝试启动（X加载较慢）
    setTimeout(startRecording, 2000);
    setTimeout(startRecording, 5000);
  }

  // 启动
  init();

  console.log('[X记录器 v2.0] 初始化完成');
})();
