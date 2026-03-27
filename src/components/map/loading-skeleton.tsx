"use client";

import { motion } from "framer-motion";

export function MapLoadingSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-6"
      >
        {/* Animated circles */}
        <div className="relative">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="h-16 w-16 rounded-full bg-orange-500/30"
          />
          <motion.div
            animate={{
              scale: [1, 1.15, 1],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: "easeInOut",
              delay: 0.3,
            }}
            className="absolute top-2 left-8 h-12 w-12 rounded-full bg-blue-500/30"
          />
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: "easeInOut",
              delay: 0.6,
            }}
            className="absolute -top-1 left-4 h-8 w-8 rounded-full bg-purple-500/30"
          />
        </div>

        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">
            Loading NJ HOA Map
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Mapping community data across New Jersey
          </p>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-48 overflow-hidden rounded-full bg-slate-800">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              repeat: Infinity,
              duration: 1.5,
              ease: "easeInOut",
            }}
            className="h-full w-1/3 rounded-full bg-gradient-to-r from-orange-500 to-blue-500"
          />
        </div>
      </motion.div>
    </div>
  );
}
