"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import "./globals.css"

export default function Home() {
  const [routes, setRoutes] = useState<string[]>([])
  const [randomUrl, setRandomUrl] = useState("#")
  const infoSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Fetch routes from GitHub
    fetch("https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json")
      .then(response => response.json())
      .then(data => {
        type RouteItem = { url: string }
        const routesArray = Array.isArray(data) ? 
          (typeof data[0] === 'string' ? data : data.map((item: RouteItem) => item.url)) : []
        setRoutes(routesArray)
        if (routesArray.length > 0) {
          setRandomUrl(routesArray[Math.floor(Math.random() * routesArray.length)])
        }
      })
      .catch(console.error)

    // Wheel scrolling only
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
      } else if (e.deltaY < 0) {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }

    window.addEventListener("wheel", handleWheel)
    return () => window.removeEventListener("wheel", handleWheel)
  }, [])

  const handleHover = () => {
    if (routes.length > 0) {
      setRandomUrl(routes[Math.floor(Math.random() * routes.length)])
    }
  }

  const scrollToInfo = () => {
    infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

   return (
    <div className="min-h-screen overflow-y-auto overflow-x-hidden snap-y snap-mandatory">
      {/* Main buttons section */}
      <section className="min-h-screen flex items-center justify-center bg-gradient-to-b from-sky-100 via-sky-200 to-cyan-200 text-sky-900 snap-start px-4">
        <div className="flex flex-col items-center gap-4 md:gap-8 relative z-10 w-full max-w-md">
          <a
            href={randomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full md:w-[400px]"
          >
            <div className="neobrutalist-button-container">
              <motion.div
                id="paddle"
                className="neobrutalist-button w-full h-14 md:h-16 bg-white text-black border-4 border-black rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden cursor-pointer"
                initial={{ x: -6, y: -6 }}
                whileHover={{ x: -3, y: -3 }}
                whileTap={{ x: 0, y: 0 }}
                animate={{ x: -6, y: -6 }}
                onMouseEnter={handleHover}
              >
                <div className="absolute inset-0 flex items-center justify-center z-10 px-2">PADDLE THE OCEAN</div>
              </motion.div>
              <div className="neobrutalist-button-shadow"></div>
            </div>
          </a>

          <div className="neobrutalist-button-container w-[120px] md:w-[140px]">
            <motion.button
              id="info"
              className="neobrutalist-button w-full h-14 md:h-16 bg-white text-black border-4 border-black rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden cursor-pointer"
              initial={{ x: -6, y: -6 }}
              whileHover={{ x: -3, y: -3 }}
              whileTap={{ x: 0, y: 0 }}
              animate={{ x: -6, y: -6 }}
              onClick={scrollToInfo}
            >
              <div className="absolute inset-0 flex items-center justify-center z-10">INFO</div>
            </motion.button>
            <div className="neobrutalist-button-shadow"></div>
          </div>
        </div>
      </section>

      {/* Info Section */}
      <section
        ref={infoSectionRef}
        className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-cyan-200 via-sky-300 to-blue-200 text-sky-900 relative snap-start px-4 py-16"
      >
        <div className="max-w-2xl text-center space-y-4 md:space-y-6 w-full px-4">
          <p className="text-base md:text-lg leading-relaxed">
            The internet was supposed to make our lives easier.
            <br /><br />
            These days, there is just too much noise out there.
            <br /><br />
            Navigating the modern web for <i>timely legal news</i> has become an unnecessarily daunting task.
            <br /><br />
            <code>Sea Kayak</code> is my attempt to restore some sanity to the web.
            <br /><br />
            Have a good time out there, Sea Kayaker.
            <br /><br />
            ~ <a href="https://gabrielongzm.com" className="text-indigo-600 md:text-indigo-500 hover:underline font-medium">Gabriel Ong</a>
          </p>
        </div>

        {/* Footer */}
        <div className="absolute bottom-4 md:bottom-8 text-sm text-center w-full px-4">
          <p className="text-xs md:text-sm">
            Source code{" "}
            <a
              href="https://github.com/gongahkia/sea-kayak"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              here
            </a>
            .
          </p>
          <p className="mt-2 md:mt-4 text-[0.7rem] md:text-xs">© 2025 Sea Kayak. All rights reserved.</p>
        </div>
      </section>
    </div>
  )
}