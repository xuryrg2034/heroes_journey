using System.Collections.Generic;
using System.Linq;
using Entities;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using UnityEngine;
using Object = UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Grid
{
    // TODO: Нужна более мудренная логика спавна. Что бы не получалось, что на арене только красные например
    public class SpawnService
    {
        private readonly List<BaseEntity> _availableEntitiesList;
        private readonly List<BaseEntity> _spawnedEntities;
        private readonly List<BaseEntity> _ensuringDestructionEntities;
        
        private const int MaxStrengthEnemies = 5;  // Максимум офицеров на поле
        
        public SpawnService(List<BaseEntity> availableEntities)
        {
            _availableEntitiesList = availableEntities;
            _spawnedEntities = _populateEntitiesFromScene();
        }
        
        public BaseEntity SpawnEntityOnCell(BaseEntity spawnBaseEntity, Vector3Int gridPosition = default)
        {

            // if (position != null)
            // {
            //     // TODO: Переписать
            //     // var entityOnCell = cell.GetEntity();
            //     //
            //     // if (entityOnCell != null)
            //     // {
            //     //     _disposeEntityOnCell(entityOnCell);
            //     // }
            // }
            
            
            var newEntity = Object.Instantiate(spawnBaseEntity);
            newEntity.Init();
            newEntity.Move(gridPosition, 0).Forget();
            
            _spawnedEntities.Add(newEntity);

            return newEntity;
        }
        
        public BaseEntity SpawnEntity(Vector3Int gridPosition)
        {
            // if (!cell.IsAvailableForEntity()) return null;

            var entityToSpawn = _getEntityWithBalance();

            return SpawnEntityOnCell(entityToSpawn, gridPosition);
        }

        public void ClearDeadEntities()
        {
            _spawnedEntities.RemoveAll(e =>
            {
                if (!e.Health.IsDead) return false;
                
                // _ensuringDestructionEntities.Add(e);
                return true;
            });
        }

        public List<BaseEntity> GetSpawnedEntities() => _spawnedEntities.Where(e => !e.Health.IsDead).ToList();

        private BaseEntity _getEntityWithBalance()
        {
            var enemies = GetSpawnedEntities().OfType<Enemy>().ToList();
            var strengthEnemies = enemies.Count(e => e.MaxHealth >= 5);

            // TODO: Нужна какая то другая логика спавна. Сейчас это не весело.
            if (strengthEnemies >= MaxStrengthEnemies) return _getRandomEnemyOfType(0);

            return _getRandomEnemyOfType(0, 5);
        }
        
        private BaseEntity _getRandomEnemyOfType(params int[] allowedHp)
        {
            var possibleEnemies = _availableEntitiesList.Where(e => allowedHp.Contains(e.MaxHealth)).ToList();
            return possibleEnemies[Random.Range(0, possibleEnemies.Count)];
        }

        private List<BaseEntity> _populateEntitiesFromScene()
        {
            var entities = Object.FindObjectsByType<BaseEntity>(FindObjectsSortMode.None).ToList();

            foreach (var entity in entities)
            {
                entity.Init();
                entity.Move(entity.SpawnPosition, 0).Forget();
            }

            return entities;
        }
        
        private void _disposeEntityOnCell(BaseEntity baseEntity)
        {
            baseEntity.Health.Die().Forget();
        }
    }
}