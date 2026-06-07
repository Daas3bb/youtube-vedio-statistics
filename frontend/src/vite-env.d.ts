/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_REPO?: string;
  readonly VITE_GITHUB_OWNER?: string;
  readonly VITE_GITHUB_REPO_NAME?: string;
  readonly VITE_GITHUB_BRANCH?: string;
  readonly VITE_YOUTUBE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
