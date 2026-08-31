from setuptools import setup, find_packages

setup(
    name="throttle-sdk",
    version="1.0.0",
    description="Python SDK for the Throttle rate limiting API",
    packages=find_packages(),
    install_requires=["requests>=2.25"],
    python_requires=">=3.7",
    extras_require={"flask": ["flask"]},
)
