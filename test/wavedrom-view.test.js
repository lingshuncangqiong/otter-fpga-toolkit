'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fitScale,zoomScroll,getWebviewHtml} = require('../wavedrom-view');

test('fit uses the full card dimensions and does not enlarge a small diagram',()=>{
    assert.equal(fitScale(474,280,1280,720),1);
    const scale=fitScale(934,340,500,400);
    assert.ok(scale*934+40<=500);
    const all=fitScale(934,900,500,400,'all');
    assert.ok(all*900+40<=400);
    assert.ok(all*934+40<=500);
    assert.equal(fitScale(474,280,0,0),null);
    assert.ok(fitScale(20000,340,500,400)<.05);
});

test('zoom keeps the same diagram point underneath the pointer',()=>{
    const oldScale=.5,newScale=2,scroll=80,pointer=220;
    const after=zoomScroll(oldScale,newScale,scroll,pointer);
    assert.equal((after+pointer-20)/newScale,(scroll+pointer-20)/oldScale);
});

test('SVG is a serialized payload, not HTML markup injected into the application',()=>{
    const html=getWebviewHtml('<svg><text>clock</text><script>bad()</script></svg>',null,null);
    assert.ok(!html.includes('<svg>'));
    assert.ok(!html.includes('<script>bad()'));
    assert.match(html,/attachShadow/);
    assert.match(html,/DOMParser/);
    assert.ok(!html.includes('fill: #d4d4d4 !important'));
});
