using Configs.Entities.Enemies;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using Services;
using Services.EventBus;
using UnityEngine;

namespace Grid.Components
{
    public class BossSpawner : MonoBehaviour
    {
        [SerializeField] Vector3Int spawnerPosition;
        [SerializeField] Enemy bossPrefab;
        [SerializeField] BossConfig bossConfig;

        SpawnService _spawnService;
        GridService _gridService;

        void OnEnable()
        {
            EventBusService.Subscribe(Actions.AllQuestCompleted, Spawn);
        }

        void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.AllQuestCompleted, Spawn);
        }

        void Start()
        {
            _spawnService = ServiceLocator.Get<SpawnService>();
            _gridService = ServiceLocator.Get<GridService>();
        }

        void Spawn()
        {
            var boss = _spawnService.SpawnEnemy(bossPrefab, bossConfig);
            var entityOnGrid = _gridService.GetEntityAt(spawnerPosition);

            if (entityOnGrid)
            {
                _spawnService.DisposeEntity(entityOnGrid);
            }
            
            boss.Move(spawnerPosition, 0).Forget();
            boss.Health.OnDie.AddListener(() =>
            {
                EventBusService.Trigger(Actions.BossDied);
            });
        }
    }
}