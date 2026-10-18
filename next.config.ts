import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components/partialPrefetching отключены (TASK-004): session reads
  // в workspace layout должны выполняться на каждый запрос, кешируемых
  // data paths у текущего shell нет. Возвращать — осознанно, с auth-анализом.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
