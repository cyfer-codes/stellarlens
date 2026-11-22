import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // `dark:` variants follow the OS/browser `prefers-color-scheme` setting.
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // Matches the gray-900 used for primary buttons and the active nav item.
        primary: "#111827"
      }
    }
  },
  plugins: []
};

export default config;
