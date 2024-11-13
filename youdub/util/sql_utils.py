"""
------------------------------------------
@File       : mysql_pool.py
@CreatedOn  : 2022/9/16 9:52
------------------------------------------
    MySQL 连接池
    参考文章：https://blog.csdn.net/weixin_41447636/article/details/110453039
"""
from contextlib import contextmanager

import pymysql
from dbutils.pooled_db import PooledDB


class MySQLConnectionPool:
    """MySQL 基本功能封装 """

    def __init__(self,
                 host: str,
                 port: int,
                 user: str,
                 passwd: str,
                 db: str):

        # utf8mb4 是utf8的超集
        self.__pool = self.gen_pool(host, port, user, passwd, db)  # 返回类字典类型游标

    @staticmethod
    def gen_pool(host, port, user, passwd, db, charset='utf8mb4'):
        pool = PooledDB(
            creator=pymysql,  # 使用链接数据库的模块
            mincached=0,  # 初始化连接池时创建的连接数。默认为0，即初始化时不创建连接(建议默认0，假如非0的话，在某些数据库不可用时，整个项目会启动不了)
            maxcached=0,  # 池中空闲连接的最大数量。默认为0，即无最大数量限制(建议默认)
            maxshared=0,  # 池中共享连接的最大数量。默认为0，即每个连接都是专用的，不可共享(不常用，建议默认)
            maxconnections=0,  # 被允许的最大连接数。默认为0，无最大数量限制
            blocking=True,  # 连接数达到最大时，新连接是否可阻塞。默认False，即达到最大连接数时，再取新连接将会报错。(建议True，达到最大连接数时，新连接阻塞，等待连接数减少再连接)
            maxusage=0,  # 连接的最大使用次数。默认0，即无使用次数限制。(建议默认)
            reset=True,  # 当连接返回到池中时，重置连接的方式。默认True，总是执行回滚
            ping=1,  # 确定何时使用ping()检查连接。默认1，即当连接被取走，做一次ping操作。0是从不ping，1是默认，2是当该连接创建游标时ping，4是执行sql语句时ping，7是总是ping
            host=host,
            port=port,
            user=user,
            passwd=passwd,
            db=db,
            charset=charset,
            use_unicode=True,
        )
        return pool

    @property
    @contextmanager
    def pool(self):
        _conn = None
        _cursor = None
        try:
            _conn = self.__pool.connection()
            _cursor = _conn.cursor(pymysql.cursors.DictCursor)
            yield _cursor
        finally:
            _conn.commit()
            _cursor.close()
            _conn.close()

    def execute(self, sql, args=None):
        with self.pool as cursor:
            cursor.execute(sql, args)
            return cursor.lastrowid

    def executemany(self, sql, args):
        with self.pool as cursor:
            cursor.executemany(sql, args)

    def fetchall(self, sql, args=None):
        with self.pool as cursor:
            cursor.execute(sql, args)
            return cursor.fetchall()

    def fetchone(self, sql, args=None):
        with self.pool as cursor:
            cursor.execute(sql, args)
            return cursor.fetchone()

    def has_table(self, table_name: str) -> bool:
        """
            该用户下是否存在表table_name
        """
        sql = "SELECT count(*) total FROM information_schema.TABLES WHERE table_name =%(table_name)s"
        arg = {'table_name': table_name}
        return self.fetchone(sql, arg).get('total') == 1

    def exist_data_by_kw(self, table_name: str, data: dict):
        """表table_name中是否存在where key = value的数据"""
        k, = data

        exist_sql = "select * from {0} where {1} = %({1})s"
        sql = exist_sql.format(table_name, k)

        f_data = self.fetchone(sql, data)
        return f_data

    def close(self):
        self.__pool.close()

    def __del__(self):
        self.close()


def getdb():
    cfg = {
        'host': 'mysql.sqlpub.com',
        'port': 3306,
        'user': 'leyuan',
        'passwd': 'Re6dVqW89d4JgZIc',
        'db': 'video_tools'
    }

    db = MySQLConnectionPool(**cfg)
    return db