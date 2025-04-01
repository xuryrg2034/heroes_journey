using System.Collections.Generic;
using System.Linq;
using Core.Factories;
using Entities;
using Cysharp.Threading.Tasks;
using Entities.Player;
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
            var entity = _enemyFactory.GetRandomSmallEnemy();
            entity.Move(gridPosition, 0).Forget();

            _spawnedEntities.Add(entity);
        }

        public Hero SpawnHero(Hero heroPrefab)
        {
            var hero = Object.Instantiate(heroPrefab);
            
            hero.Init();
            hero.Move(heroPrefab.SpawnPosition, 0).Forget();
            _spawnedEntities.Add(hero);
            
            return hero;
        }

        public List<BaseEntity> GetSpawnedEntities() => _spawnedEntities.Where(e => !e.Health.IsDead).ToList();
        
        void _disposeEntityOnCell(BaseEntity baseEntity)
        {
            baseEntity.Health.Die().Forget();
        }
    }
}