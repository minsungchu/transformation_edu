import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: '로봇 좌표계 이론 교재',
  tagline:
    'Transformation Matrix · Calibration · Matching — 로봇 응용을 위한 좌표계 이론 튜토리얼',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  // GitHub Pages 공개 배포 (사용자 결정으로 issue #1의 사내 전용 방침 변경)
  url: 'https://minsungchu.github.io',
  baseUrl: '/transformation_edu/',
  organizationName: 'minsungchu',
  projectName: 'transformation_edu',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'ko',
    locales: ['ko'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: '로봇 좌표계 이론 교재',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'curriculumSidebar',
          position: 'left',
          label: '교재',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} CMES Robotics — 사내 교육용 자료입니다.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
