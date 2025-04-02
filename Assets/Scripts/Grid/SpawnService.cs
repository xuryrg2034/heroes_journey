using System.Collections.Generic;
using System.Linq;
using Core.Factories;
using Entities;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using Entities.Player;
using Interfaces;
using UnityEngine;

namespace Grid
{
    // TODO: Нужна более мудренная логика спавна. Что бы не получалось, что на арене только красные например
    public class SpawnService
    {
        readonly List<BaseEntity> _spawnedEntities = new();
        
        readonly List<BaseEntity> _ensuringDestructionEntities;
        
        readonly EnemyFactory _enemyFactory;
        
        public SpawnService()
        {
            _enemyFactory = new EnemyFactory();
        }
        
        public void SpawnSmallEnemy(Vector3Int gridPosition)
        {
            var enemy = _enemyFactory.GetRandomSmallEnemy();
            
            enemy.Move(gridPosition, 0).Forget();

            _spawnedEntities.Add(enemy);
        }

        public Hero SpawnHero(Hero heroPrefab)
        {
            var hero = Object.Instantiate(heroPrefab);
            
            hero.Init();
            hero.Move(heroPrefab.SpawnPosition, 0).Forget();
            _spawnedEntities.Add(hero);
            
            return hero;
        }

        public Enemy SpawnEnemy(Enemy entityPrefab, IEnemyConfig config)
        {
            var enemy = Object.Instantiate(entityPrefab);

            enemy.Init(config);
            
            _spawnedEntities.Add(enemy);
            
            return enemy;
        }

        public List<BaseEntity> GetSpawnedEntities() => _spawnedEntities.Where(e => !e.Health.IsDead).ToList();
        
        public void DisposeEntity(BaseEntity baseEntity)
        {
            baseEntity.Health.Die().Forget();
        }
    }
}