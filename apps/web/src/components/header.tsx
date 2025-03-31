import { Link } from "@tanstack/react-router";
import { ModeToggle } from "./mode-toggle";

export default function Header() {
	const links = [{ to: "/", label: "drastic" }];

	return (
		<div>
			<div className="fixed w-full flex flex-row items-center justify-between px-2 py-2">
				<nav className="flex gap-4 text-xl border-none shadow-none">
					{links.map(({ to, label }) => (
						<Link
							key={to}
							to={to}
							activeProps={{ className: "font-semibold font-lg pl-2" }}
							activeOptions={{ exact: true }}
						>
							<span className="inline-flex items-center">
								<span className="h-6 w-6 text-lg rounded-full bg-white mr-3" />
								{label}
							</span>
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
				</div>
			</div>
		</div>
	);
}
