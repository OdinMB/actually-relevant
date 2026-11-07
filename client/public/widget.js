(function () {
  'use strict'

  var script = document.currentScript
  if (!script) return

  var config = {
    count: Math.min(5, Math.max(1, parseInt(script.getAttribute('data-count') || '3', 10) || 3)),
    issue: script.getAttribute('data-issue') || '',
    theme: script.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    title: script.getAttribute('data-title') || 'Actually Relevant',
    customTitle: script.getAttribute('data-title') || '',
  }

  var API_BASE = 'https://api.actuallyrelevant.news/api'
  var SITE_URL = 'https://actuallyrelevant.news'
  // The widget puts AI-written headlines on other people's sites, so its header always says so
  // (AI Act Art. 50(4)); a custom data-title is shown above it, never instead of it.
  var AI_HEADER = 'AI-generated headlines from Actually Relevant'

  // Create container with shadow DOM for style isolation
  var container = document.createElement('div')
  script.parentNode.insertBefore(container, script.nextSibling)
  var shadow = container.attachShadow({ mode: 'open' })

  var isDark = config.theme === 'dark'
  var bg = isDark ? '#1a1a1a' : '#ffffff'
  var text = isDark ? '#e5e5e5' : '#404040'
  var textMuted = isDark ? '#a3a3a3' : '#737373'
  var border = isDark ? '#333333' : '#e5e5e5'
  var accent = isDark ? '#93c5fd' : '#1d4ed8'
  var hoverBg = isDark ? '#262626' : '#f5f5f5'

  var style = document.createElement('style')
  style.textContent = [
    '.ar-widget { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:' + bg + '; border: 1px solid ' + border + '; border-radius: 8px; overflow: hidden; max-width: 400px; font-size: 14px; line-height: 1.5; color:' + text + '; }',
    '.ar-header { padding: 12px 16px; border-bottom: 1px solid ' + border + '; display: flex; align-items: center; gap: 8px; }',
    '.ar-header-icon { width: 14px; height: 14px; color:' + accent + '; }',
    '.ar-header-title { font-weight: 600; font-size: 13px; letter-spacing: 0.025em; }',
    '.ar-header-text { display: flex; flex-direction: column; gap: 2px; }',
    '.ar-header-note { font-size: 12px; color:' + textMuted + '; }',
    '.ar-header-ai { display: inline-flex; align-items: center; gap: 6px; }',
    '.ar-badge { display: inline-block; border: 1px solid currentColor; border-radius: 3px; padding: 1px 4px; font-size: 10px; font-weight: 700; line-height: 1; letter-spacing: 0.025em; }',
    '.ar-list { list-style: none; margin: 0; padding: 0; }',
    '.ar-item { padding: 10px 16px; border-bottom: 1px solid ' + border + '; }',
    '.ar-item:last-child { border-bottom: none; }',
    '.ar-item:hover { background:' + hoverBg + '; }',
    '.ar-link { text-decoration: none; color: inherit; display: block; }',
    '.ar-link:hover .ar-title { color:' + accent + '; }',
    '.ar-title { font-weight: 500; font-size: 14px; margin: 0 0 2px; transition: color 0.15s; }',
    '.ar-meta { font-size: 12px; color:' + textMuted + '; }',
    '.ar-footer { padding: 8px 16px; border-top: 1px solid ' + border + '; text-align: center; }',
    '.ar-footer a { font-size: 11px; color:' + textMuted + '; text-decoration: none; }',
    '.ar-footer a:hover { color:' + accent + '; }',
    '.ar-loading { padding: 24px 16px; text-align: center; color:' + textMuted + '; font-size: 13px; }',
    '.ar-error { padding: 16px; text-align: center; color: #ef4444; font-size: 13px; }',
  ].join('\n')
  shadow.appendChild(style)

  var widget = document.createElement('div')
  widget.className = 'ar-widget'
  widget.setAttribute('role', 'region')
  widget.setAttribute('aria-label', config.title)
  widget.innerHTML = '<div class="ar-loading">Loading stories...</div>'
  shadow.appendChild(widget)

  function timeAgo(dateStr) {
    var date = new Date(dateStr)
    var now = new Date()
    var seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    var minutes = Math.floor(seconds / 60)
    if (minutes < 60) return minutes + 'm ago'
    var hours = Math.floor(minutes / 60)
    if (hours < 24) return hours + 'h ago'
    var days = Math.floor(hours / 24)
    if (days < 30) return days + 'd ago'
    return date.toLocaleDateString()
  }

  function escapeHtml(str) {
    var div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // The Mood Dial (data-mix), with the site's names and numbers (client/src/contexts/PositivityContext.tsx);
  // data-mood="uplifting" is the older spelling of data-mix="uplifting". null: every story, newest first.
  var MIX_NAMES = { heavy: 0, 'mostly-heavy': 25, balanced: 50, 'mostly-uplifting': 75, uplifting: 100 }
  function parseMix(raw) {
    if (raw === null) return null
    var value = String(raw).trim().toLowerCase()
    if (Object.prototype.hasOwnProperty.call(MIX_NAMES, value)) return MIX_NAMES[value]
    if (!/^\d{1,3}$/.test(value) || Number(value) > 100) return null
    var n = Number(value)
    var best = 0
    ;[0, 25, 50, 75, 100].forEach(function (p) {
      if (Math.abs(n - p) < Math.abs(n - best)) best = p
    })
    return best
  }
  var mix = parseMix(script.getAttribute('data-mix'))
  if (mix === null && script.getAttribute('data-mood') === 'uplifting') mix = 100

  // A mixed widget picks from the newest stories of every tone, so it still makes one request per load
  var MIX_POOL = 50

  function storiesUrl(emotionTags, pageSize) {
    var params = new URLSearchParams()
    params.set('pageSize', String(pageSize))
    params.set('page', '1')
    if (config.issue) params.set('issueSlug', config.issue)
    if (emotionTags) params.set('emotionTags', emotionTags)
    // Tells the API this request is a widget load, which it counts as a widget view (no other data
    // is sent). A query parameter, not a header, so the request needs no CORS preflight.
    params.set('ref', 'widget')
    return API_BASE + '/stories?' + params.toString()
  }

  function getStories(url, done) {
    var xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.onload = function () {
      if (xhr.status !== 200) return done(true)
      try {
        done(false, JSON.parse(xhr.responseText).data || [])
      } catch (e) {
        done(true)
      }
    }
    xhr.onerror = function () {
      done(true)
    }
    xhr.send()
  }

  function storyTime(s) {
    return new Date(s.datePublished || s.dateCrawled).getTime()
  }

  // Below "Only uplifting", the homepage's mix (client/src/lib/mix-stories.ts): the dial's share of
  // the slots from the positive stories, the rest from the negative ones, a shortfall filled from the other.
  function mixStories(positive, negative) {
    var positiveCount = Math.round((config.count * mix) / 100)
    var picked = positive.slice(0, positiveCount).concat(negative.slice(0, config.count - positiveCount))
    var used = {}
    picked.forEach(function (s) {
      used[s.id] = true
    })
    positive.concat(negative).forEach(function (s) {
      if (picked.length < config.count && !used[s.id]) {
        picked.push(s)
        used[s.id] = true
      }
    })
    return picked.sort(function (a, b) {
      return storyTime(b) - storyTime(a)
    })
  }

  function loadStories(done) {
    if (mix === null) return getStories(storiesUrl('', config.count), done)
    if (mix === 100) return getStories(storiesUrl('uplifting', config.count), done)
    getStories(storiesUrl('', MIX_POOL), function (failed, stories) {
      if (failed) return done(true)
      // Untagged stories are left out, as on the homepage
      var positive = stories.filter(function (s) {
        return s.emotionTag === 'uplifting' || s.emotionTag === 'calm'
      })
      var negative = stories.filter(function (s) {
        return s.emotionTag === 'frustrating' || s.emotionTag === 'scary'
      })
      done(false, mixStories(positive, negative))
    })
  }

  loadStories(function (failed, stories) {
    if (failed) {
      widget.innerHTML = '<div class="ar-error">Could not load stories</div>'
      return
    }
    try {
      if (stories.length === 0) {
        widget.innerHTML = '<div class="ar-loading">No stories available</div>'
        return
      }
      var html = '<div class="ar-header">'
      html += '<svg class="ar-header-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'
      html += '<div class="ar-header-text">'
      if (config.customTitle) {
        html += '<span class="ar-header-title">' + escapeHtml(config.customTitle) + '</span>'
      }
      html += '<span class="ar-header-ai ' + (config.customTitle ? 'ar-header-note' : 'ar-header-title') + '">'
      html += '<span class="ar-badge" aria-hidden="true">AI</span>' + AI_HEADER + '</span>'
      html += '</div></div>'
      html += '<ul class="ar-list">'
      stories.forEach(function (story) {
        var storyTitle = story.title || story.sourceTitle
        var storyUrl = SITE_URL + '/stories/' + (story.slug || story.id)
        var source = (story.feed && (story.feed.displayTitle || story.feed.title)) || ''
        var date = story.datePublished || story.dateCrawled
        html += '<li class="ar-item">'
        html += '<a class="ar-link" href="' + escapeHtml(storyUrl) + '" target="_blank" rel="noopener noreferrer">'
        html += '<p class="ar-title">' + escapeHtml(storyTitle) + '</p>'
        html += '<span class="ar-meta">' + escapeHtml(source) + (date ? ' &middot; ' + timeAgo(date) : '') + '</span>'
        html += '</a></li>'
      })
      html += '</ul>'
      html += '<div class="ar-footer"><a href="' + SITE_URL + '" target="_blank" rel="noopener noreferrer">Powered by Actually Relevant</a></div>'
      widget.innerHTML = html
    } catch (e) {
      widget.innerHTML = '<div class="ar-error">Could not load stories</div>'
    }
  })
})()
