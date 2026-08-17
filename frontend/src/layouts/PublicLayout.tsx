import { Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Bus, Menu, X, Phone, Mail, MapPin } from 'lucide-react';
import { FaFacebook, FaTwitter, FaInstagram, FaYoutube } from 'react-icons/fa';
import { useState } from 'react';

export function PublicLayout() {
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const navLinks = [
        { path: '/', label: 'Home' },
        { path: '/book', label: 'Book Ticket' },
    ];

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="min-h-screen flex flex-col">

            {/* Navbar */}
            <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* Logo */}
                        <Link to="/" className="flex items-center gap-2 group">
                            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                                <Bus className="h-5 w-5 text-white" />
                            </div>
                            <span className="text-xl font-bold text-gray-900">
                                Shuttle<span className="text-primary">Hub</span>
                            </span>
                        </Link>

                        {/* Desktop Navigation */}
                        <div className="hidden md:flex items-center gap-6">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.path}
                                    to={link.path}
                                    className={`
                                        text-sm font-medium transition-colors hover:text-primary
                                        ${isActive(link.path)
                                            ? 'text-primary border-b-2 border-primary pb-1'
                                            : 'text-gray-600'
                                        }
                                    `}
                                >
                                    {link.label}
                                </Link>
                            ))}
                            <div className="flex items-center gap-3">
                                <Button variant="outline" size="sm" >
                                    <Link to="/login">Sign In</Link>
                                </Button>
                                <Button size="sm" >
                                    <Link to="/register">Get Started</Link>
                                </Button>
                            </div>
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
                            aria-label="Toggle menu"
                        >
                            {isMenuOpen ? (
                                <X className="h-6 w-6 text-gray-600" />
                            ) : (
                                <Menu className="h-6 w-6 text-gray-600" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMenuOpen && (
                    <div className="md:hidden border-t border-gray-200 bg-white">
                        <div className="px-4 py-4 space-y-3">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.path}
                                    to={link.path}
                                    onClick={() => setIsMenuOpen(false)}
                                    className={`
                                        block px-3 py-2 rounded-lg text-sm font-medium transition-colors
                                        ${isActive(link.path)
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-gray-600 hover:bg-gray-50'
                                        }
                                    `}
                                >
                                    {link.label}
                                </Link>
                            ))}
                            <div className="pt-3 space-y-2 border-t border-gray-200">
                                <Button variant="outline" className="w-full" >
                                    <Link to="/login" onClick={() => setIsMenuOpen(false)}>
                                        Sign In
                                    </Link>
                                </Button>
                                <Button className="w-full" >
                                    <Link to="/register" onClick={() => setIsMenuOpen(false)}>
                                        Get Started
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </nav>

            {/* Main Content */}
            {/* Main Content */}
            <main className="flex-1">
                <Outlet />
            </main>

            {/* Footer */}
            <footer className="bg-gray-900 text-gray-300">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                        {/* Brand */}
                        <div className="col-span-1 md:col-span-1">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                                    <Bus className="h-5 w-5 text-white" />
                                </div>
                                <span className="text-xl font-bold text-white">
                                    Shuttle<span className="text-primary">Hub</span>
                                </span>
                            </div>
                            <p className="text-sm leading-relaxed">
                                Book your shuttle tickets instantly. No account needed — just your name and phone.
                            </p>
                            <div className="flex gap-3 mt-4">
                                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                                    <FaFacebook className="h-5 w-5" />
                                </a>
                                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                                    <FaTwitter className="h-5 w-5" />
                                </a>
                                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                                    <FaInstagram className="h-5 w-5" />
                                </a>
                                <a href="#" className="text-gray-400 hover:text-white transition-colors">
                                    <FaYoutube className="h-5 w-5" />
                                </a>
                            </div>
                        </div>

                        {/* Quick Links */}
                        <div>
                            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
                            <ul className="space-y-2.5">
                                <li>
                                    <Link to="/" className="text-sm hover:text-white transition-colors">
                                        Home
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/book" className="text-sm hover:text-white transition-colors">
                                        Book Ticket
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/login" className="text-sm hover:text-white transition-colors">
                                        Sign In
                                    </Link>
                                </li>
                                <li>
                                    <Link to="/register" className="text-sm hover:text-white transition-colors">
                                        Register
                                    </Link>
                                </li>
                            </ul>
                        </div>

                        {/* Support */}
                        <div>
                            <h3 className="text-white font-semibold mb-4">Support</h3>
                            <ul className="space-y-2.5">
                                <li className="flex items-center gap-2 text-sm">
                                    <Phone className="h-4 w-4 text-primary" />
                                    <span>+254 700 123 456</span>
                                </li>
                                <li className="flex items-center gap-2 text-sm">
                                    <Mail className="h-4 w-4 text-primary" />
                                    <span>support@shuttlehub.com</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm">
                                    <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                    <span>Nairobi, Kenya</span>
                                </li>
                            </ul>
                        </div>

                        {/* Opening Hours */}
                        <div>
                            <h3 className="text-white font-semibold mb-4">Operating Hours</h3>
                            <ul className="space-y-2 text-sm">
                                <li className="flex justify-between">
                                    <span>Monday - Friday</span>
                                    <span className="text-gray-400">6:00 AM - 10:00 PM</span>
                                </li>
                                <li className="flex justify-between">
                                    <span>Saturday</span>
                                    <span className="text-gray-400">7:00 AM - 10:00 PM</span>
                                </li>
                                <li className="flex justify-between">
                                    <span>Sunday</span>
                                    <span className="text-gray-400">8:00 AM - 8:00 PM</span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    {/* Bottom Bar */}
                    <div className="border-t border-gray-800 mt-8 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm">
                        <p>© {new Date().getFullYear()} ShuttleHub. All rights reserved.</p>
                        <div className="flex gap-6">
                            <Link to="/privacy" className="hover:text-white transition-colors">
                                Privacy Policy
                            </Link>
                            <Link to="/terms" className="hover:text-white transition-colors">
                                Terms of Service
                            </Link>
                            <Link to="/cookies" className="hover:text-white transition-colors">
                                Cookies
                            </Link>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}