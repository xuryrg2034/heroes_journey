using Interfaces;
using Unity.VisualScripting.Dependencies.Sqlite;
using UnityEngine;
namespace Configs.Entities
{
    [CreateAssetMenu(menuName = "Configs/Entities/Hero", fileName = "Hero")]
    public class HeroConfig : ScriptableObject, IBaseEntityConfig
    {
        [field: SerializeField] public int MaxHealth { get; private set; }
        
        [field: SerializeField] public int Damage { get; private set; }
        
        [field: SerializeField, Range(0, 10)] public int Energy { get; private set; }
    }
}
