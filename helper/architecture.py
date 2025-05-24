from diagrams import Diagram, Cluster
from diagrams.onprem.client import Users
from diagrams.onprem.ci import GithubActions
from diagrams.programming.language import Python
from diagrams.onprem.compute import Server
from diagrams.custom import Custom

graph_attr = {"nodesep": "1.2", "ranksep": "1.5", "fontsize": "12", "splines": "ortho"}

with Diagram(
    "Sea Kayak Architecture", show=False, direction="TB", graph_attr=graph_attr
):
    user = Users("User")

    with Cluster("Backend"):
        github_action = GithubActions("GitHub Scheduled\nAction")
        main_py = Python("main.py\n(Scheduler)")

        with Cluster("Concurrent Scrapers"):
            scrapers = [
                Python("local.py\n"),
                Python("superfeed.py\n"),
                Python("unstructured.py\n"),
            ]

        fitness_sites = Custom("Legal RSS Feeds", "./browser.png")
        static_site = Server("Static Site\n(routes.json)")
        github_action >> main_py
        main_py >> scrapers
        scrapers >> fitness_sites
        scrapers >> main_py
        main_py >> static_site

    with Cluster("Frontend"):
        svelte_code = Custom("React Frontend", "./react.png")
        vercel = Custom("Vercel Next.js", "./vercel.png")
        live_site = Server("Live Site")

        static_site >> svelte_code
        svelte_code >> vercel
        vercel >> live_site
        user >> live_site
